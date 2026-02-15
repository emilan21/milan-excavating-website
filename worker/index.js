// Cloudflare Worker for Visitor Counter - Milan Excavating
// Deploys to: https://milan-excavating-counter.youraccount.workers.dev

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { 
        status: 204, 
        headers: corsHeaders 
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // GET /counts/get - Get current count
      if (path === '/counts/get' && request.method === 'GET') {
        const count = await env.MILAN_COUNTER.get('count') || '0';
        return new Response(
          JSON.stringify({ count: parseInt(count) }),
          { 
            status: 200, 
            headers: { 
              ...corsHeaders,
              'Content-Type': 'application/json' 
            } 
          }
        );
      }

      // POST /counts/increment - Increment count
      if (path === '/counts/increment' && request.method === 'POST') {
        // Get current count
        const currentCount = await env.MILAN_COUNTER.get('count') || '0';
        const newCount = parseInt(currentCount) + 1;
        
        // Save new count to KV
        await env.MILAN_COUNTER.put('count', newCount.toString());
        
        return new Response(
          JSON.stringify({ count: newCount }),
          { 
            status: 200, 
            headers: { 
              ...corsHeaders,
              'Content-Type': 'application/json' 
            } 
          }
        );
      }

      // Health check
      if (path === '/health') {
        return new Response(
          JSON.stringify({ status: 'ok' }),
          { 
            status: 200, 
            headers: { 
              ...corsHeaders,
              'Content-Type': 'application/json' 
            } 
          }
        );
      }

      // Not found
      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { 
          status: 404, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );

    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { 
          status: 500, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }
  }
};
