export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { b365Image, bfImage, b365Mime, bfMime } = req.body;
    if (!b365Image || !bfImage) return res.status(400).json({ error: 'Missing images' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured on Vercel' });

    const prompt = `You are analyzing two betting site screenshots for NBA player assists over/under markets.
Image 1 = Bet365. Image 2 = Betfair Sportsbook.

Extract the odds for each player's assists O/U market from both sites.

IMPORTANT: All odds are in DECIMAL format between 1.01 and 5.00. Examples: 1.57, 1.83, 2.25, 1.90, 2.10.
If you see a number like 10, 14, 30 that is NOT an odd — it is likely a line value or other data. Ignore it.

Return ONLY a valid JSON array:
[{"name":"Player Name","team":"DET or CLE","linha":2.5,"b365over":1.90,"b365under":1.85,"bfover":2.10,"bfunder":1.75}]

Rules:
- odds must be decimal numbers between 1.01 and 5.00
- if a player is missing from one site use null for that site's odds
- linha is the assists line (e.g. 1.5, 2.5, 3.5, 6.5, 8.5)
- only assists markets
- no markdown, no explanation, just the JSON array`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5-20250514',
                max_tokens: 2000,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: b365Mime, data: b365Image } },
                        { type: 'image', source: { type: 'base64', media_type: bfMime, data: bfImage } },
                        { type: 'text', text: prompt }
                    ]
                }]
            })
        });

        const data = await response.json();
        if (data.error) return res.status(500).json({ error: data.error.message });

        let raw = data.content.map(c => c.text || '').join('').trim();

        // remove markdown se vier
        raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();

        // extrai só o array JSON mesmo que venha texto ao redor
        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) return res.status(500).json({ error: 'IA não retornou JSON válido. Tente novamente.' });

        let players;
        try {
            players = JSON.parse(match[0]);
        } catch (parseErr) {
            return res.status(500).json({ error: 'JSON inválido retornado pela IA: ' + parseErr.message });
        }

        // filtra jogadores com nome válido
        players = players.filter(p => p && typeof p.name === 'string' && p.name.trim().length > 0);

        return res.status(200).json({ players });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}