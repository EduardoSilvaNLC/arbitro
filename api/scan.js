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

    const prompt = `Analyze these two betting screenshots for NBA player assists O/U markets.
Image 1 = Bet365. Image 2 = Betfair.

Return ONLY a valid JSON array. No markdown, no explanation, no code blocks, no trailing commas.
Example format:
[{"name":"Player Name","team":"DET","linha":7.5,"b365over":1.90,"b365under":1.85,"bfover":2.10,"bfunder":1.75}]

Rules:
- If a player appears in only one site, use null for missing odds (e.g. "bfover":null,"bfunder":null)
- Use the exact decimal line shown (e.g. 7.5, 2.5, 1.5)
- Only assists markets, not rebounds or points
- Match players by name across both images
- Return every player you can find
- All numbers must be valid JSON decimals (e.g. 1.90 not 1,90)
- Do not include any text outside the JSON array`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
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