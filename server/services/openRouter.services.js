import axios from 'axios'

export const askAi=async(messages)=>{
    const startedAt=Date.now()   // LLM calls are the slowest thing this server does: log how long they take
    try {
        if(!messages || !Array.isArray(messages) || messages.length===0){
            throw  new Error("Message array is empty:");
        }
        const response=await axios.post('https://openrouter.ai/api/v1/chat/completions',
            {
                model:'openai/gpt-4o-mini',
                messages:messages,
                max_tokens:1000   // caps the cost of any single call

        },
    {headers: {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout:30000});   // do not let a slow upstream hold the request open forever
  const content=response?.data?.choices?.[0]?.message?.content;
  if(!content || !content.trim()){
    throw new Error("AI returned empty response")
  }
  const promptChars=messages.reduce((n,m)=>n+String(m?.content ?? "").length,0)
  console.log(`LLM call ok in ${Date.now()-startedAt}ms (prompt ${promptChars} chars, reply ${content.length} chars)`)
  return content
    } catch (error) {
        console.error(`OpenRouter Error after ${Date.now()-startedAt}ms:`,error.response?.data|| error.message);
        throw new Error("OpenRouter API Error");
    }
}