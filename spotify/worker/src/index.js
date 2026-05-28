export default {
  async fetch(request) {
    const res = await fetch("https://api.github.com/zen", { // temp
      headers: { "User-Agent": "kathirm-widgets" },
    });
    const message = await res.text();
    return new Response(JSON.stringify({ message }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};