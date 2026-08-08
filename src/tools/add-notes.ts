import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { createClient } from '@supabase/supabase-js';
import { gatekeeper } from "../lib/gatekeeper";

export const schema = {
  // Identification - exactly one required
  id: z.number().optional().describe("Add notes to vehicle by specific ID"),
  vin: z.string().optional().describe("Add notes to vehicle by VIN number"),
  stockNumber: z.string().optional().describe("Add notes to vehicle by stock number"),
  
  // Notes field - optional, can be null to delete notes
  notes: z.string().nullable().optional().describe("Notes to add to the vehicle. Set to null or empty string to delete existing notes"),
};

export const metadata: ToolMetadata = {
  name: "add-notes",
  description: "Add or update notes for a vehicle in the SportcarsLux database. Set notes to null to delete them.",
  annotations: {
    title: "Add Notes to Vehicle",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
};

export default async function addNotes({
  id,
  vin,
  stockNumber,
  notes,
}: InferSchema<typeof schema>) {
  const gate = await gatekeeper("T2", { roles: ["team"] });
  if (!gate.allow) return gate.message;

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return `Error: Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file`;
    }

    // Validate that exactly one identifier is provided
    const identifierCount = [id, vin, stockNumber].filter(Boolean).length;
    if (identifierCount === 0) {
      return `Error: Please provide one identifier ('id', 'vin', or 'stockNumber') to identify the vehicle.`;
    }

    if (identifierCount > 1) {
      return `Error: Please provide only one identifier ('id', 'vin', OR 'stockNumber'), not multiple.`;
    }

    // Validate that notes is provided
    if (notes === undefined) {
      return `Error: Please provide 'notes' field. Use null or empty string to delete existing notes.`;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Build the query to find the vehicle
    let query = supabase
      .from('vehicles')
      .select('id, year, make, model, vin, stock_number, notes')
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

    // Prepare the update data
    // If notes is null or empty string, set it to null to delete
    const notesValue = notes === null || notes === '' ? null : notes;
    
    const updateData = {
      notes: notesValue,
      updated_at: new Date().toISOString(),
    };

    // Perform the update
    const { data: updatedVehicle, error: updateError } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicle.id)
      .select('id, year, make, model, vin, notes')
      .single();

    if (updateError) {
      return `Error updating vehicle notes: ${updateError.message}`;
    }

    // Format the response
    const action = notesValue === null ? 'deleted' : vehicle.notes ? 'updated' : 'added';
    const notesDisplay = notesValue === null ? 'No notes' : notesValue;

    return `Successfully ${action} notes for vehicle:\n\n` +
           `Vehicle: ${vehicleInfo}\n` +
           `ID: ${updatedVehicle.id}\n` +
           `VIN: ${updatedVehicle.vin || 'N/A'}\n` +
           `Notes: ${notesDisplay}`;
    
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

