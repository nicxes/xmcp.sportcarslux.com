import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { createClient } from '@supabase/supabase-js';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { gatekeeper } from "../lib/gatekeeper";

export const schema = {
  // Identification - exactly one required
  id: z.number().optional().describe("Delete AI video for vehicle by specific ID"),
  vin: z.string().optional().describe("Delete AI video for vehicle by VIN number"),
  stockNumber: z.string().optional().describe("Delete AI video for vehicle by stock number"),
};

export const metadata: ToolMetadata = {
  name: "delete-ai-video",
  description: "Delete AI video for a vehicle. Sets ai_video field to null in Supabase and deletes the file from Cloudflare R2. This allows the video to be regenerated in the next batch.",
  annotations: {
    title: "Delete AI Video",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
};

/**
 * Delete object from Cloudflare R2 using AWS S3 SDK
 */
async function deleteFromR2(
  bucketName: string,
  objectKey: string,
  endpoint: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Create S3 client configured for Cloudflare R2
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: endpoint,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
      },
    });

    // Delete the object
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    });

    await s3Client.send(command);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error deleting from R2',
    };
  }
}

export default async function deleteAiVideo({
  id,
  vin,
  stockNumber,
}: InferSchema<typeof schema>) {
  const gate = await gatekeeper("T4", { roles: ["it-manager", "manager", "owner", "admin"] });
  if (!gate.allow) return gate.message;

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return `Error: Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file`;
    }

    // Cloudflare R2 credentials
    const r2Endpoint = process.env.R2_ENDPOINT;
    const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const r2BucketName = process.env.R2_BUCKET_NAME;

    // Validate that exactly one identifier is provided
    const identifierCount = [id, vin, stockNumber].filter(Boolean).length;
    if (identifierCount === 0) {
      return `Error: Please provide one identifier ('id', 'vin', or 'stockNumber') to identify the vehicle.`;
    }

    if (identifierCount > 1) {
      return `Error: Please provide only one identifier ('id', 'vin', OR 'stockNumber'), not multiple.`;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Build the query to find the vehicle
    let query = supabase
      .from('vehicles')
      .select('id, year, make, model, vin, stock_number, ai_video')
      .is('deleted_at', null);

    // Apply filter based on provided identifier
    if (id) {
      query = query.eq('id', id);
    } else if (vin) {
      query = query.eq('vin', vin);
    } else if (stockNumber) {
      query = query.eq('stock_number', stockNumber);
    }

    // First, get the vehicle that matches the criteria
    const { data: vehicles, error: selectError } = await query;

    if (selectError) {
      return `Error finding vehicle: ${selectError.message}`;
    }

    if (!vehicles || vehicles.length === 0) {
      const identifier = id ? `ID: ${id}` : vin ? `VIN: ${vin}` : `Stock Number: ${stockNumber}`;
      return `No vehicle found with ${identifier}.`;
    }

    if (vehicles.length > 1) {
      return `Error: Multiple vehicles found with the same identifier. This shouldn't happen. Please contact support.`;
    }

    const vehicle = vehicles[0];
    const vehicleInfo = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim();

    // Check if vehicle has an ai_video
    if (!vehicle.ai_video) {
      return `Vehicle ${vehicleInfo} (ID: ${vehicle.id}) does not have an AI video to delete.`;
    }

    // Check if vehicle has stock_number (required to construct R2 path)
    if (!vehicle.stock_number) {
      return `Vehicle ${vehicleInfo} (ID: ${vehicle.id}) does not have a stock number. Cannot determine R2 file path.`;
    }

    const aiVideoUrl = vehicle.ai_video;
    let r2DeleteResult: { success: boolean; error?: string } | null = null;

    // Delete from Cloudflare R2 if credentials are provided
    // R2 path format: vehicles/{stockNumber}/ai-video.mp4
    if (r2Endpoint && r2AccessKeyId && r2SecretAccessKey && r2BucketName) {
      const objectKey = `vehicles/${vehicle.stock_number}/ai-video.mp4`;
      
      r2DeleteResult = await deleteFromR2(
        r2BucketName,
        objectKey,
        r2Endpoint,
        r2AccessKeyId,
        r2SecretAccessKey
      );
    }

    // Update Supabase to set ai_video to null
    const updateData = {
      ai_video: null,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedVehicle, error: updateError } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicle.id)
      .select('id, year, make, model, vin, ai_video')
      .single();

    if (updateError) {
      return `Error updating vehicle: ${updateError.message}`;
    }

    // Format the response
    let response = `Successfully deleted AI video for vehicle:\n\n` +
                   `Vehicle: ${vehicleInfo}\n` +
                   `ID: ${updatedVehicle.id}\n` +
                   `VIN: ${updatedVehicle.vin || 'N/A'}\n` +
                   `Previous AI Video URL: ${aiVideoUrl}\n\n`;

    if (r2DeleteResult) {
      if (r2DeleteResult.success) {
        response += `✅ File deleted from Cloudflare R2\n`;
      } else {
        response += `⚠️  Warning: Could not delete file from Cloudflare R2: ${r2DeleteResult.error}\n`;
        response += `   (Database field has been set to null)\n`;
      }
    } else {
      response += `⚠️  Note: Cloudflare R2 credentials not configured. Only database field was updated.\n`;
    }

    response += `\n✅ Database field 'ai_video' set to null. Video will be regenerated in the next batch.`;

    return response;
    
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

