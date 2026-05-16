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

    const prompt = `You are analyzing two betting site screenshots for football (soccer) player props markets.
Image 1 = Bet365. Image 2 = Betfair Sportsbook.

Extract odds for shots on target over/under markets for each player.

IMPORTANT: All odds are in DECIMAL format between 1.01 and 5.00. Examples: 1.57, 1.83, 2.25, 1.90, 2.10.
If you see a number like 10, 14, 30 that is NOT an odd — it is a line value. Ignore it as an odd.
When reading the line from Betfair, ignore the + sign. "+1.5" means the line is 1.5.

Return ONLY a valid JSON array, no markdown, no explanation:
[{"name":"Player Name","team":"Team Name","league":"Premier League","b365linha":1.5,"bflinha":1.5,"b365over":1.90,"b365under":1.85,"bfover":2.10,"bfunder":1.75}]

Rules:
- odds must be decimal numbers between 1.01 and 5.00 only
- b365linha = the exact line number shown on Bet365 for that player
- bflinha = the exact line number shown on Betfair for that player (ignore + sign)
- include ALL players found on either site
- if player only appears on one site, use null for missing odds and null for missing linha
- only shots on target markets
- match players by name across both images
- valid JSON only, no trailing commas`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5',
                max_tokens: 4000,
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
        raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();

        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) return res.status(500).json({ error: 'IA não retornou JSON válido. Tente novamente.' });

        let players;
        try {
            players = JSON.parse(match[0]);
        } catch (parseErr) {
            return res.status(500).json({ error: 'JSON inválido: ' + parseErr.message });
        }

        // filtra nome válido
        players = players.filter(p => p && typeof p.name === 'string' && p.name.trim().length > 0);

        // remove jogadores com linhas diferentes entre casas
        players = players.filter(p => {
            if (p.b365linha && p.bflinha) {
                const l1 = parseFloat(String(p.b365linha).replace('+', ''));
                const l2 = parseFloat(String(p.bflinha).replace('+', ''));
                return l1 === l2;
            }
            return true;
        });

        // normaliza linha única
        players = players.map(p => ({
            ...p,
            linha: parseFloat(String(p.b365linha || p.bflinha).replace('+', ''))
        }));

        return res.status(200).json({ players });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}