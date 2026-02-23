// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("process-dataset edge function loaded")

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    console.log("Received webhook payload:", JSON.stringify(payload))
    
    // The webhook sends the new row in the payload.record property
    const record = payload.record
    if (!record || !record.id) {
      return new Response("Invalid payload: missing record.id", { status: 400 })
    }

    const jobId = record.id
    const fileKey = record.file_key
    const outputFormat = record.output_format

    // We need a Supabase client with the SERVICE_ROLE key to bypass RLS and update the job status
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Update status to 'processing'
    console.log(`Updating job ${jobId} to 'processing'...`)
    const { error: updateError1 } = await supabase
      .from('dataset_jobs')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', jobId)

    if (updateError1) {
      console.error("Error updating status to processing:", updateError1)
      return new Response("Error updating status", { status: 500 })
    }

    // 2. Simulate heavy dataset processing
    // In reality, you would download the file from S3 using the fileKey, 
    // parse it, chunk it, and format it to JSONL or whatever outputFormat is specified.
    console.log(`Simulating processing of file ${fileKey} to format ${outputFormat}...`)
    
    // simulate processing time (e.g. 5 seconds)
    await new Promise(resolve => setTimeout(resolve, 5000))

    // 3. Mark job as completed and simulate a new result URL
    const mockResultUrl = `https://storage.example.com/processed/${jobId}_processed.${outputFormat}`
    console.log(`Finished processing. Updating job ${jobId} to 'completed'...`)
    
    const { error: updateError2 } = await supabase
      .from('dataset_jobs')
      .update({ 
        status: 'completed', 
        result_url: mockResultUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)

    if (updateError2) {
      console.error("Error updating status to completed:", updateError2)
      return new Response("Error updating final status", { status: 500 })
    }

    return new Response(
      JSON.stringify({ message: `Successfully processed job ${jobId}` }),
      { headers: { "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("Function error:", err.message)
    return new Response(String(err?.message ?? err), { status: 500 })
  }
})
