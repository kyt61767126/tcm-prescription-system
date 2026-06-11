export async function onRequest(context) {
    return new Response(JSON.stringify({
        success: true,
        message: 'Test API is working!',
        timestamp: new Date().toISOString()
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}