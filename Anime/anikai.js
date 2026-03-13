/**
 * AnimeKai extension for PLAY-ON!
 * Uses the same request flow as the published Consumet AnimeKai provider,
 * adapted to the PLAY-ON! extension contract.
 */
const tauriFetch = fetch;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const BASE_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.5',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'Referer': 'https://anikai.to/',
    'Cookie': '__p_mov=1; usertype=guest; session=vLrU4aKItp0QltI2asH83yugyWDsSSQtyl9sxWKO'
};
const TOKEN_API_BASE = 'https://enc-dec.app/api';

const pageCache = new Map();

function normalizeQuery(query) {
    return (query || '').trim().replace(/[\W_]+/g, '+');
}

function parseStatus(value) {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'completed') return 'completed';
    if (normalized === 'releasing') return 'ongoing';
    if (normalized === 'not yet aired') return 'hiatus';
    return 'unknown';
}

function extractBackgroundUrl(style) {
    const match = (style || '').match(/background-image:\s*url\(['"]?(.+?)['"]?\)/i);
    return match ? match[1] : '';
}

function getText(node) {
    return node?.textContent?.trim() || '';
}

function getAbsoluteUrl(baseUrl, value) {
    if (!value) return '';
    try {
        return new URL(value, baseUrl).toString();
    } catch {
        return value;
    }
}

function encodeBody(payload) {
    return JSON.stringify(payload);
}

async function requestText(url, headers = {}) {
    const response = await tauriFetch(url, {
        method: 'GET',
        headers: { ...BASE_HEADERS, ...headers }
    });
    return response.text();
}

async function requestJson(url, headers = {}) {
    const response = await tauriFetch(url, {
        method: 'GET',
        headers: { ...BASE_HEADERS, ...headers }
    });
    return response.json();
}

async function postJson(url, payload, headers = {}) {
    const response = await tauriFetch(url, {
        method: 'POST',
        headers: {
            ...BASE_HEADERS,
            'Content-Type': 'application/json',
            ...headers
        },
        body: encodeBody(payload)
    });
    return response.json();
}

async function generateKaiToken(text) {
    const data = await requestJson(`${TOKEN_API_BASE}/enc-kai?text=${encodeURIComponent(text)}`, {
        'Referer': 'https://enc-dec.app/'
    });
    if (!data?.result) {
        throw new Error('Failed to generate AnimeKai token');
    }
    return data.result;
}

async function decodeKaiIframe(text) {
    const data = await postJson(`${TOKEN_API_BASE}/dec-kai`, { text }, {
        'Referer': 'https://enc-dec.app/'
    });
    if (!data?.result?.url) {
        throw new Error('Failed to decode AnimeKai iframe payload');
    }
    return data.result;
}

async function decodeMegaPayload(text) {
    const data = await postJson(`${TOKEN_API_BASE}/dec-mega`, {
        text,
        agent: USER_AGENT
    }, {
        'Referer': 'https://enc-dec.app/'
    });
    if (!data?.result?.sources) {
        throw new Error('Failed to decode MegaUp payload');
    }
    return data.result;
}

async function extractMegaSources(embedUrl) {
    const mediaUrl = embedUrl.replace('/e/', '/media/');
    const mediaResponse = await requestJson(mediaUrl, {
        'Referer': embedUrl,
        'Cookie': ''
    });
    return decodeMegaPayload(mediaResponse.result);
}

async function fetchAnimePage(baseUrl, animeId) {
    if (!pageCache.has(animeId)) {
        pageCache.set(animeId, (async () => {
            const url = `${baseUrl}/watch/${animeId}`;
            const html = await requestText(url, { 'Referer': url });
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const ratingBox = doc.querySelector('.rate-box#anime-rating');
            const watchPage = doc.querySelector('#watch-page');
            return {
                doc,
                url,
                aniId: ratingBox?.getAttribute('data-id') || '',
                aniListId: watchPage?.getAttribute('data-al-id') || '',
                malId: watchPage?.getAttribute('data-mal-id') || ''
            };
        })());
    }
    return pageCache.get(animeId);
}

function parseSearchResults(baseUrl, doc) {
    const anime = [];
    doc.querySelectorAll('.aitem-wrapper.regular .aitem').forEach((item) => {
        const watchLink = item.querySelector('a.poster');
        const titleEl = item.querySelector('a.title');
        const imageEl = item.querySelector('img');
        const href = watchLink?.getAttribute('href') || '';
        const id = href.replace('/watch/', '').trim();
        if (!id) return;
        const typeNodes = item.querySelectorAll('.info > *');
        const type = getText(typeNodes[typeNodes.length - 1]);
        anime.push({
            id,
            title: titleEl?.getAttribute('title') || getText(titleEl) || 'Unknown',
            coverUrl: getAbsoluteUrl(baseUrl, imageEl?.getAttribute('data-src') || imageEl?.getAttribute('src') || ''),
            status: 'unknown',
            type: type || undefined,
            totalEpisodes: parseInt(getText(typeNodes[typeNodes.length - 2]) || getText(item.querySelector('.info .sub')) || '0', 10) || undefined,
            subOrDub: item.querySelector('.info .sub') && item.querySelector('.info .dub') ? 'both' : item.querySelector('.info .dub') ? 'dub' : 'sub',
            url: getAbsoluteUrl(baseUrl, href)
        });
    });
    return anime;
}

function parseEpisodeId(episodeId) {
    const [animeId, ...parts] = episodeId.split('$');
    const data = { animeId };
    parts.forEach((part) => {
        const [key, ...valueParts] = part.split('=');
        data[key] = valueParts.join('=');
    });
    return data;
}

function buildEpisodeId(animeId, episodeNumber, slug, token, langs) {
    return `${animeId}$ep=${episodeNumber}$slug=${encodeURIComponent(slug)}$token=${encodeURIComponent(token)}$langs=${langs || ''}`;
}

function mapEpisodeServer(serverEl, category) {
    return {
        id: serverEl.getAttribute('data-lid') || '',
        name: getText(serverEl) || 'Server',
        category
    };
}

return {
    id: 'anikai',
    name: 'AnimeKai',
    baseUrl: 'https://anikai.to',
    lang: 'en',
    version: '1.0.0',
    iconUrl: 'https://anikai.to/assets/uploads/37585a3ffa8ec292ee9e2255f3f63b48ceca17e5241280b3dc21.png',

    async search(filter) {
        const query = normalizeQuery(filter.query || '');
        const page = filter.page || 1;
        const url = `${this.baseUrl}/browser?keyword=${query}&page=${page}`;
        const html = await requestText(url, { 'Referer': `${this.baseUrl}/browser` });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return {
            anime: parseSearchResults(this.baseUrl, doc),
            hasNextPage: !!doc.querySelector('.pagination .page-item.active + .page-item a.page-link')
        };
    },

    async getAnimeInfo(animeId) {
        const page = await fetchAnimePage(this.baseUrl, animeId);
        const { doc, aniListId, malId } = page;
        const detailGroups = Array.from(doc.querySelectorAll('.entity-scroll > .detail > div > div'));
        const getDetailValue = (label) => {
            const node = detailGroups.find((entry) => getText(entry).toLowerCase().startsWith(label.toLowerCase()));
            return getText(node?.querySelector('span')) || '';
        };
        const genres = Array.from(doc.querySelectorAll('.entity-scroll > .detail a[href*="/genres/"]')).map((node) => getText(node)).filter(Boolean);
        const totalEpisodes = parseInt(getDetailValue('Episodes:') || '0', 10) || undefined;

        return {
            id: animeId,
            title: getText(doc.querySelector('.entity-scroll > .title')) || 'Unknown',
            coverUrl: getAbsoluteUrl(this.baseUrl, doc.querySelector('div.poster > div > img')?.getAttribute('src') || ''),
            description: getText(doc.querySelector('.entity-scroll > .desc')),
            status: parseStatus(getDetailValue('Status:')),
            type: getText(doc.querySelector('.entity-scroll > .info > *:last-child')) || undefined,
            genres,
            totalEpisodes,
            releaseDate: getDetailValue('Date aired:') || undefined,
            subOrDub: doc.querySelector('.entity-scroll > .info > .sub') && doc.querySelector('.entity-scroll > .info > .dub') ? 'both' : doc.querySelector('.entity-scroll > .info > .dub') ? 'dub' : 'sub',
            url: `${this.baseUrl}/watch/${animeId}`,
            anilistId: aniListId || undefined,
            malId: malId || undefined
        };
    },

    async getEpisodes(animeId) {
        const page = await fetchAnimePage(this.baseUrl, animeId);
        if (!page.aniId) {
            throw new Error('Failed to resolve AnimeKai anime id');
        }

        const token = await generateKaiToken(page.aniId);
        const data = await requestJson(`${this.baseUrl}/ajax/episodes/list?ani_id=${encodeURIComponent(page.aniId)}&_=${encodeURIComponent(token)}`, {
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `${this.baseUrl}/watch/${animeId}`
        });

        if (!data?.result) {
            throw new Error(data?.message || 'Failed to load AnimeKai episodes');
        }

        const doc = new DOMParser().parseFromString(data.result, 'text/html');
        return Array.from(doc.querySelectorAll('.eplist ul li a')).map((link) => {
            const episodeNumber = parseInt(link.getAttribute('num') || '0', 10) || 0;
            const slug = link.getAttribute('slug') || String(episodeNumber);
            const episodeToken = link.getAttribute('token') || '';
            const langs = link.getAttribute('langs') || '';
            const uncensoredTag = link.querySelector('b') ? ' (Uncensored)' : '';
            const baseTitle = getText(link.querySelector('span')) || `Episode ${episodeNumber}`;
            return {
                id: buildEpisodeId(animeId, episodeNumber, slug, episodeToken, langs),
                number: episodeNumber,
                title: `${baseTitle}${uncensoredTag}`,
                hasSub: langs === '1' || langs === '3',
                hasDub: langs === '2' || langs === '3',
                url: `${this.baseUrl}/watch/${animeId}#ep=${slug}`
            };
        });
    },

    async getEpisodeServers(episodeId) {
        const parsed = parseEpisodeId(episodeId);
        const episodeToken = decodeURIComponent(parsed.token || '');
        if (!episodeToken) {
            throw new Error('Missing AnimeKai episode token');
        }

        const token = await generateKaiToken(episodeToken);
        const data = await requestJson(`${this.baseUrl}/ajax/links/list?token=${encodeURIComponent(episodeToken)}&_=${encodeURIComponent(token)}`, {
            'Referer': `${this.baseUrl}/watch/${parsed.animeId}`
        });

        if (!data?.result) {
            throw new Error(data?.message || 'Failed to load AnimeKai servers');
        }

        const doc = new DOMParser().parseFromString(data.result, 'text/html');
        const servers = [];
        doc.querySelectorAll('.server-items.lang-group[data-id="sub"] .server').forEach((node) => {
            servers.push(mapEpisodeServer(node, 'sub'));
        });
        doc.querySelectorAll('.server-items.lang-group[data-id="dub"] .server').forEach((node) => {
            servers.push(mapEpisodeServer(node, 'dub'));
        });
        return servers;
    },

    async getEpisodeSources(episodeId, server, dub = false) {
        const parsed = parseEpisodeId(episodeId);
        const servers = await this.getEpisodeServers(episodeId);
        const preferredCategory = dub ? 'dub' : 'sub';
        const preferredServers = servers.filter((entry) => entry.category === preferredCategory);
        const fallbackServers = servers.filter((entry) => entry.category !== preferredCategory);
        const orderedServers = [];

        if (server) {
            const explicit = servers.find((entry) => entry.id === server || entry.name.toLowerCase() === String(server).toLowerCase());
            if (explicit) orderedServers.push(explicit);
        }

        preferredServers.forEach((entry) => {
            if (!orderedServers.some((candidate) => candidate.id === entry.id)) orderedServers.push(entry);
        });
        fallbackServers.forEach((entry) => {
            if (!orderedServers.some((candidate) => candidate.id === entry.id)) orderedServers.push(entry);
        });

        if (orderedServers.length === 0) {
            throw new Error('No AnimeKai servers available');
        }

        let lastError = null;
        for (const entry of orderedServers) {
            try {
                const lidToken = await generateKaiToken(entry.id);
                const linkView = await requestJson(`${this.baseUrl}/ajax/links/view?id=${encodeURIComponent(entry.id)}&_=${encodeURIComponent(lidToken)}`, {
                    'Referer': `${this.baseUrl}/watch/${parsed.animeId}`
                });
                const iframeData = await decodeKaiIframe(linkView.result);
                const mediaData = await extractMegaSources(iframeData.url);
                const subtitles = (mediaData.tracks || [])
                    .filter((track) => track.kind !== 'thumbnails')
                    .map((track) => ({
                        url: track.file,
                        lang: track.label || track.kind || 'Unknown'
                    }));

                return {
                    sources: (mediaData.sources || []).map((source) => ({
                        url: source.file || source.url,
                        quality: source.label || source.quality || 'auto',
                        isM3U8: (source.file || source.url || '').includes('.m3u8')
                    })),
                    subtitles,
                    headers: {
                        'Referer': new URL(iframeData.url).origin + '/',
                        'User-Agent': USER_AGENT
                    },
                    intro: Array.isArray(iframeData.skip?.intro) ? {
                        start: iframeData.skip.intro[0] || 0,
                        end: iframeData.skip.intro[1] || 0
                    } : undefined,
                    outro: Array.isArray(iframeData.skip?.outro) ? {
                        start: iframeData.skip.outro[0] || 0,
                        end: iframeData.skip.outro[1] || 0
                    } : undefined
                };
            } catch (error) {
                lastError = error;
                console.warn('[AnimeKai] Server failed:', entry.name, error);
            }
        }

        throw lastError || new Error('All AnimeKai servers failed');
    }
};