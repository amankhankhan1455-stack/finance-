require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

app.post('/chat', async (req, res) => {
    try {
        const { message, summary } = req.body;
        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ error: 'OpenAI API key is missing on the server.' });
        }

        const systemPrompt = `You are a helpful, professional AI financial advisor built into the FinanceFlow dashboard. The user currently has a balance of $${summary.balance.toFixed(2)}, total income of $${summary.totalIncome.toFixed(2)}, and total expenses of $${summary.totalExpense.toFixed(2)}. Answer their financial questions concisely (1-3 sentences) and provide helpful advice based on this context.`;

        // Node 18+ has native fetch. If using an older version, we would need node-fetch.
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: message }
                ],
                max_tokens: 150,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('OpenAI API Error:', errorData);
            
            // Fallback response for quota/billing errors so the UI still works
            const mockResponse = `(Mock AI Response) Your OpenAI API key has exceeded its quota or is invalid. But based on your current balance of $${summary.balance.toFixed(2)}, I recommend keeping an eye on your expenses!`;
            return res.json({ reply: mockResponse });
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        res.json({ reply: aiResponse });
    } catch (error) {
        console.error('Error in /chat endpoint:', error.message);
        res.status(500).json({ error: 'Failed to process chat request', details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
