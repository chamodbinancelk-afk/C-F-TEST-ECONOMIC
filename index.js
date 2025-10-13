const { load } = require('cheerio');
const moment = require('moment-timezone');


// 🚨🚨 CRITICAL: ඔබගේ සැබෑ BOT TOKEN එක මෙහි ඇතුල් කරන්න! 🚨🚨
const TELEGRAM_TOKEN = '8299929776:AAGKU7rkfakmDBXdgiGSWzAHPgLRJs-twZg'; 

// 🚨🚨 CRITICAL: පණිවිඩ ලැබිය යුතු CHAT ID එක මෙහි ඇතුල් කරන්න! 🚨🚨
const CHAT_ID = '-1003177936060'; 


const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Cloudflare Worker)' };
const FF_URL = "https://www.forexfactory.com/news";

// --- KV KEY ---
const LAST_HEADLINE_KEY = 'last_forex_headline';


// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================
// (sendRawTelegramMessage, readLastHeadlineKV, writeLastHeadlineKV, translateText functions remain the same)
// ...
async function sendRawTelegramMessage(chatId, message, imgUrl = null) {
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') {
        console.error("TELEGRAM_TOKEN is missing or not updated.");
        return;
    }
    
    let apiMethod = imgUrl ? 'sendPhoto' : 'sendMessage';
    let payload = { chat_id: chatId, parse_mode: 'HTML' };

    if (imgUrl) {
        payload.photo = imgUrl;
        payload.caption = message;
    } else {
        payload.text = message;
    }

    const apiURL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/${apiMethod}`;
    
    try {
        const response = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Telegram API Error (${apiMethod}): ${response.status} - ${errorText}`);
        }
    } catch (error) {
        console.error("Error sending message to Telegram:", error);
    }
}

async function readLastHeadlineKV(env, key) {
    try {
        const last = await env.NEWS_STATE.get(key);
        return last;
    } catch (e) {
        console.error(`KV Read Error (${key}):`, e);
        return null;
    }
}

async function writeLastHeadlineKV(env, key, headline) {
    try {
        await env.NEWS_STATE.put(key, headline);
    } catch (e) {
        console.error(`KV Write Error (${key}):`, e);
    }
}

async function translateText(text) {
    const translationApiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=si&dt=t&q=${encodeURIComponent(text)}`;
    try {
        const response = await fetch(translationApiUrl);
        const data = await response.json();
        return data[0].map(item => item[0]).join('');
    } catch (e) {
        console.error('Translation API Error. Using original text.', e);
        return `[Translation Failed: ${text}]`;
    }
}
// ... (utility functions end)


// =================================================================
// --- CORE FOREX NEWS LOGIC ---
// =================================================================

async function getLatestForexNews() {
    const resp = await fetch(FF_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);

    const html = await resp.text();
    const $ = load(html);
    const newsLinkTag = $('a[href^="/news/"]').not('a[href$="/hit"]').first();

    if (newsLinkTag.length === 0) return null;

    const headline = newsLinkTag.text().trim();
    const newsUrl = "https://www.forexfactory.com" + newsLinkTag.attr('href');
    
    // Fetch detail page
    const newsResp = await fetch(newsUrl, { headers: HEADERS });
    if (!newsResp.ok) throw new Error(`HTTP error! status: ${resp.status} on detail page`);

    const newsHtml = await newsResp.text();
    const $detail = load(newsHtml);
    const imgUrl = $detail('img.attach').attr('src');
    const description = $detail('p.news__copy').text().trim() || "No description found.";

    return { headline, newsUrl, imgUrl, description };
}

async function fetchForexNews(env) {
    try {
        // 1. Get the latest news from the website
        const news = await getLatestForexNews();
        if (!news) return;

        // 2. Read the last saved headline from KV
        const lastHeadline = await readLastHeadlineKV(env, LAST_HEADLINE_KEY);

        // 3. 🚨 CRITICAL CHECK: If headlines match, STOP and do nothing.
        if (news.headline === lastHeadline) {
            console.info(`Forex: No new headline. Last: ${news.headline}`);
            return; // EXIT - Prevents duplication
        }
        
        // --- ONLY PROCEED IF THE HEADLINE IS NEW ---

        // 4. Save the NEW headline to KV
        await writeLastHeadlineKV(env, LAST_HEADLINE_KEY, news.headline);

        // 5. Generate and send the message
        const description_si = await translateText(news.description);
        const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        
        const message = `<b>💵 Fundamental News (Forex/සිංහල)</b>\n\n` +
                        `<b>⏰ Date & Time:</b> ${date_time}\n\n` +
                        `<b>🌎 Headline (English):</b> ${news.headline}\n\n` +
                        `<b>🔥 සිංහල:</b> ${description_si}\n\n` +
                        `<a href="${news.newsUrl}">Read Full Article</a>\n\n` +
                        `🚀 <b>Dev: Mr Chamo 🇱🇰</b>`;

        await sendRawTelegramMessage(CHAT_ID, message, news.imgUrl);
    } catch (error) {
        console.error("An error occurred during FOREX task:", error);
    }
}

// =================================================================
// --- CLOUDFLARE WORKER HANDLERS ---
// (These handlers remain the same)
// =================================================================

async function handleScheduledTasks(env) {
    await fetchForexNews(env);
}

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleScheduledTasks(env));
    },

    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Manual trigger
        if (url.pathname === '/trigger') {
            await handleScheduledTasks(env);
            return new Response("Scheduled task (Forex Only) manually triggered. Check your Telegram channel for the news (if new).", { status: 200 });
        }
        
        // Status check
        if (url.pathname === '/status') {
            const lastForex = await readLastHeadlineKV(env, LAST_HEADLINE_KEY);
            return new Response(`Forex Bot Worker is active.\nLast Forex Headline: ${lastForex || 'N/A'}`, { status: 200 });
        }

        // Webhook Handling
        if (request.method === 'POST') {
             try {
                const update = await request.json();
                if (update.message && update.message.chat) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text || "";
                    const replyText = `ඔයා type කරපු දේ: <b>${text}</b>`;
                    await sendRawTelegramMessage(chatId, replyText);
                }
                return new Response('OK', { status: 200 });
            } catch (e) {
                 console.error('Webhook error:', e);
                 return new Response('OK', { status: 200 });
            }
        }

        return new Response('Forex News Bot is ready. Use /trigger to test manually.', { status: 200 });
    }
};


        return new Response('Forex News Bot is ready. Use /trigger to test manually.', { status: 200 });
    }
};

