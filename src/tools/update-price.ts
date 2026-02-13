import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { createClient } from "@supabase/supabase-js";

export const schema = {
  // Identification - exactly one required
  id: z.number().optional().describe("Update price by specific vehicle ID"),
  vin: z.string().optional().describe("Update price by VIN number"),
  stockNumber: z.string().optional().describe("Update price by stock number"),

  // Price field - required
  price: z.number().nonnegative().optional().describe("New base price"),
};

export const metadata: ToolMetadata = {
  name: "update-price",
  description: "Update price and/or custom price for a single vehicle in the SportcarsLux database.",
  annotations: {
    title: "Update Vehicle Price",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
};

export default async function updatePrice({
  id,
  vin,
  stockNumber,
  price,
}: InferSchema<typeof schema>) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return "Error: Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file";
    }

    const identifierCount = [id, vin, stockNumber].filter((v) => v !== undefined).length;
    if (identifierCount === 0) {
      return "Error: Please provide one identifier ('id', 'vin', or 'stockNumber') to identify the vehicle.";
    }
    if (identifierCount > 1) {
      return "Error: Please provide only one identifier ('id', 'vin', OR 'stockNumber'), not multiple.";
    }

    if (price === undefined) {
      return "Error: Please provide 'price' to update the vehicle price.";
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase
      .from("vehicles")
      .select("id, year, make, model, vin, stock_number, price")
      .is("deleted_at", null);

    if (id !== undefined) {
      query = query.eq("id", id);
    } else if (vin !== undefined) {
      query = query.eq("vin", vin);
    } else if (stockNumber !== undefined) {
      query = query.eq("stock_number", stockNumber);
    }

    const { data: vehicles, error: selectError } = await query;

    if (selectError) {
      return `Error finding vehicle: ${selectError.message}`;
    }

    if (!vehicles || vehicles.length === 0) {
      const identifier = id !== undefined ? `ID: ${id}` : vin !== undefined ? `VIN: ${vin}` : `Stock Number: ${stockNumber}`;
      return `No vehicle found with ${identifier}.`;
    }

    if (vehicles.length > 1) {
      return "Error: Multiple vehicles found with the same identifier. This shouldn't happen. Please contact support.";
    }

    const vehicle = vehicles[0];
    const vehicleInfo = `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}`.trim();

    const updateData: Record<string, number | string> = {
      updated_at: new Date().toISOString(),
    };
    updateData.price = price;

    const { data: updatedVehicle, error: updateError } = await supabase
      .from("vehicles")
      .update(updateData)
      .eq("id", vehicle.id)
      .select("id, year, make, model, vin, stock_number, price")
      .single();

    if (updateError) {
      return `Error updating vehicle price: ${updateError.message}`;
    }

    const formatMoney = (value: number | null) => (value === null ? "N/A" : `$${value.toLocaleString()}`);

    return (
      `Successfully updated vehicle price:\n\n` +
      `Vehicle: ${vehicleInfo}\n` +
      `ID: ${updatedVehicle.id}\n` +
      `VIN: ${updatedVehicle.vin || "N/A"}\n` +
      `Stock Number: ${updatedVehicle.stock_number || "N/A"}\n\n` +
      `Price: ${formatMoney(vehicle.price)} -> ${formatMoney(updatedVehicle.price)}`
    );
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
