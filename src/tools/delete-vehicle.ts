import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { createClient } from '@supabase/supabase-js';
import { gatekeeper } from "../lib/gatekeeper";

export const schema = {
  // Identification - exactly one required
  vin: z.string().optional().describe("Delete vehicle by VIN number"),
  stockNumber: z.string().optional().describe("Delete vehicle by stock number"),
};

export const metadata: ToolMetadata = {
  name: "delete-vehicle",
  description: "Permanently delete a vehicle from Sport Cars Lux database by VIN or stock number. Note: This vehicle will be automatically re-added by vAuto during the next sync/refresh (approximately every 2 hours) IF it is still present in vAuto's inventory.",
  annotations: {
    title: "Delete Vehicle",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
};

export default async function deleteVehicle({
  vin,
  stockNumber,
}: InferSchema<typeof schema>) {
  const gate = await gatekeeper("T4");
  if (!gate.allow) return gate.message;

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return `Error: Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file`;
    }

    // Validate that exactly one identifier is provided
    if (!vin && !stockNumber) {
      return `Error: Please provide either 'vin' or 'stockNumber' to identify the vehicle to delete.`;
    }

    if (vin && stockNumber) {
      return `Error: Please provide only one identifier ('vin' OR 'stockNumber'), not both.`;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Build the query to find the vehicle to delete
    let query = supabase
      .from('vehicles')
      .select('id, year, make, model, vin, stock_number');

    // Apply filter based on provided identifier
    if (vin) {
      query = query.eq('vin', vin);
    } else if (stockNumber) {
      query = query.eq('stock_number', stockNumber);
    }

    // First, get the vehicle that matches the criteria
    const { data: vehiclesToDelete, error: selectError } = await query;

    if (selectError) {
      return `Error finding vehicle: ${selectError.message}`;
    }

    if (!vehiclesToDelete || vehiclesToDelete.length === 0) {
      const identifier = vin ? `VIN: ${vin}` : `Stock Number: ${stockNumber}`;
      return `No vehicle found with ${identifier}. It may have already been deleted or doesn't exist.`;
    }

    if (vehiclesToDelete.length > 1) {
      return `Error: Multiple vehicles found with the same identifier. This shouldn't happen. Please contact support.`;
    }

    const vehicleToDelete = vehiclesToDelete[0];
    const vehicleInfo = `${vehicleToDelete.year || ''} ${vehicleToDelete.make || ''} ${vehicleToDelete.model || ''}`.trim();

    // Perform hard delete (permanent deletion)
    const { error: deleteError } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', vehicleToDelete.id);

    if (deleteError) {
      return `Error deleting vehicle: ${deleteError.message}`;
    }

    return `Successfully deleted vehicle:\n\n` +
           `Vehicle: ${vehicleInfo}\n` +
           `ID: ${vehicleToDelete.id}\n` +
           `VIN: ${vehicleToDelete.vin || 'N/A'}\n` +
           `Stock Number: ${vehicleToDelete.stock_number || 'N/A'}\n\n` +
           `⚠️  Warning: This vehicle will be automatically re-added by vAuto during the next sync/refresh (approximately every 2 hours) IF it is still present in vAuto's inventory.`;
    
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

