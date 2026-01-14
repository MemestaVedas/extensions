/**
 * HiAnime Extension - Direct scraping with MegaCloud extraction
 * Uses the Tauri HTTP plugin (passed as 'fetch' parameter) to bypass CORS
 */
// Capture the Tauri fetch passed by the loader
const tauriFetch = fetch;
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://hianime.to/'
};
// ========== MegaCloud Decryption Helpers ==========
function keygen2(megacloudKey, clientKey) {
    const keygenHashMultVal = 31n;
    const keygenXORVal = 247;
    const keygenShiftVal = 5;
    let tempKey = megacloudKey + clientKey;
    let hashVal = 0n;
    for (let i = 0; i < tempKey.length; i++) {
        hashVal = BigInt(tempKey.charCodeAt(i)) + hashVal * keygenHashMultVal + (hashVal << 7n) - hashVal;
    }
    hashVal = hashVal < 0n ? -hashVal : hashVal;
    const lHash = Number(hashVal % 0x7fffffffffffffffn);
    tempKey = tempKey.split('').map((c) => String.fromCharCode(c.charCodeAt(0) ^ keygenXORVal)).join('');
    const pivot = (lHash % tempKey.length) + keygenShiftVal;
    tempKey = tempKey.slice(pivot) + tempKey.slice(0, pivot);
    const leafStr = clientKey.split('').reverse().join('');
    let returnKey = '';
    for (let i = 0; i < Math.max(tempKey.length, leafStr.length); i++) {
        returnKey += (tempKey[i] || '') + (leafStr[i] || '');
    }
    returnKey = returnKey.substring(0, 96 + (lHash % 33));
    returnKey = [...returnKey].map((c) => String.fromCharCode((c.charCodeAt(0) % 95) + 32)).join('');
    return returnKey;
}
function seedShuffle2(CharacterArray, iKey) {
    let hashVal = 0n;
    for (let i = 0; i < iKey.length; i++) {
        hashVal = (hashVal * 31n + BigInt(iKey.charCodeAt(i))) & 0xffffffffn;
    }
    let shuffleNum = hashVal;
    const psudoRand = (arg) => {
        shuffleNum = (shuffleNum * 1103515245n + 12345n) & 0x7fffffffn;
        return Number(shuffleNum % BigInt(arg));
    };
    const retStr = [...CharacterArray];
    for (let i = retStr.length - 1; i > 0; i--) {
        const swapIndex = psudoRand(i + 1);
        [retStr[i], retStr[swapIndex]] = [retStr[swapIndex], retStr[i]];
    }
    return retStr;
}
function columnarCipher2(src, ikey) {
    const columnCount = ikey.length;
    const rowCount = Math.ceil(src.length / columnCount);
    const cipherArry = Array(rowCount).fill(null).map(() => Array(columnCount).fill(' '));
    const keyMap = ikey.split('').map((char, index) => ({ char, idx: index }));
    const sortedMap = [...keyMap].sort((a, b) => a.char.charCodeAt(0) - b.char.charCodeAt(0));
    let srcIndex = 0;
    sortedMap.forEach(({ idx: index }) => {
        for (let i = 0; i < rowCount; i++) {
            cipherArry[i][index] = src[srcIndex++];
        }
    });
    let returnStr = '';
    for (let x = 0; x < rowCount; x++) {
        for (let y = 0; y < columnCount; y++) {
            returnStr += cipherArry[x][y];
        }
    }
    return returnStr;
}
function decryptSrc2(src, clientKey, megacloudKey) {
    const layers = 3;
    const genKey = keygen2(megacloudKey, clientKey);
    let decSrc = atob(src);
    const charArray = [...Array(95)].map((_val, index) => String.fromCharCode(32 + index));
    const reverseLayer = (iteration) => {
        const layerKey = genKey + iteration;
        let hashVal = 0n;
        for (let i = 0; i < layerKey.length; i++) {
            hashVal = (hashVal * 31n + BigInt(layerKey.charCodeAt(i))) & 0xffffffffn;
        }
        let seed = hashVal;
        const seedRand = (arg) => {
            seed = (seed * 1103515245n + 12345n) & 0x7fffffffn;
            return Number(seed % BigInt(arg));
        };
        decSrc = decSrc.split('').map((char) => {
            const cArryIndex = charArray.indexOf(char);
            if (cArryIndex === -1) return char;
            const randNum = seedRand(95);
            const newCharIndex = (cArryIndex - randNum + 95) % 95;
            return charArray[newCharIndex];
        }).join('');
        decSrc = columnarCipher2(decSrc, layerKey);
        const subValues = seedShuffle2(charArray, layerKey);
        const charMap = {};
        subValues.forEach((char, index) => { charMap[char] = charArray[index]; });
        decSrc = decSrc.split('').map((char) => charMap[char] || char).join('');
    };
    for (let i = layers; i > 0; i--) { reverseLayer(i); }
    const dataLen = parseInt(decSrc.substring(0, 4), 10);
    return decSrc.substring(4, 4 + dataLen);
}
async function getMegaCloudClientKey(xrax) {
    try {
        const req = await tauriFetch(`https://megacloud.blog/embed-2/v3/e-1/${xrax}`, {
            headers: { ...HEADERS, 'Referer': 'https://hianime.to/' }
        });
        const text = await req.text();
        const regexPatterns = [
            /<meta name="_gg_fb" content="[a-zA-Z0-9]+">/,
            /<!--\s+_is_th:[0-9a-zA-Z]+\s+-->/,
            /<script>window._lk_db\s+=\s+\{[xyz]:\s+["'][a-zA-Z0-9]+["'],\s+[xyz]:\s+["'][a-zA-Z0-9]+["'],\s+[xyz]:\s+["'][a-zA-Z0-9]+["']\};<\/script>/,
            /<div\s+data-dpi="[0-9a-zA-Z]+"\s+.*><\/div>/,
            /<script nonce="[0-9a-zA-Z]+">/,
            /<script>window._xy_ws = ['"`][0-9a-zA-Z]+['"`];<\/script>/,
        ];
        const keyRegex = /"[a-zA-Z0-9]+"/;
        let match = null, patternIndex = 0;
        for (let i = 0; i < regexPatterns.length; i++) {
            match = text.match(regexPatterns[i]);
            if (match !== null) { patternIndex = i; break; }
        }
        if (match === null) { console.warn('[HiAnime] Failed extracting client key'); return null; }
        let clientKey = '';
        if (patternIndex === 2) {
            const lk_db_regex = [/x:\s+"[a-zA-Z0-9]+"/, /y:\s+"[a-zA-Z0-9]+"/, /z:\s+"[a-zA-Z0-9]+"/];
            const x = match[0].match(lk_db_regex[0]), y = match[0].match(lk_db_regex[1]), z = match[0].match(lk_db_regex[2]);
            if (x && y && z) {
                const p1 = x[0].match(keyRegex), p2 = y[0].match(keyRegex), p3 = z[0].match(keyRegex);
                if (p1 && p2 && p3) clientKey = `${p1[0].replace(/"/g, '')}${p2[0].replace(/"/g, '')}${p3[0].replace(/"/g, '')}`;
            }
        } else if (patternIndex === 1) {
            const keyTest = match[0].match(/:[a-zA-Z0-9]+ /);
            if (keyTest) clientKey = keyTest[0].replace(':', '').replace(' ', '');
        } else {
            const keyTest = match[0].match(keyRegex);
            if (keyTest) clientKey = keyTest[0].replace(/"/g, '');
        }
        console.log(`[HiAnime] Client key extracted: ${clientKey.substring(0, 8)}...`);
        return clientKey;
    } catch (err) { console.error('[HiAnime] Failed to get client key:', err); return null; }
}
async function getMegaCloudKey() {
    try {
        const res = await tauriFetch('https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json', { headers: HEADERS });
        const data = await res.json();
        return data.mega || null;
    } catch (err) { console.error('[HiAnime] Failed to fetch megacloud key:', err); return null; }
}
async function extractFromEmbed(embedUrl) {
    try {
        console.log(`[HiAnime] Extracting from embed: ${embedUrl}`);
        const urlObj = new URL(embedUrl);
        const pathParts = urlObj.pathname.split('/');
        let videoId = '';
        for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i].startsWith('e-') && pathParts[i + 1]) {
                videoId = pathParts[i + 1].split('?')[0]; break;
            }
        }
        if (!videoId) videoId = pathParts[pathParts.length - 1].split('?')[0];
        console.log(`[HiAnime] Video ID: ${videoId}`);
        const clientKey = await getMegaCloudClientKey(videoId);
        const megacloudKey = await getMegaCloudKey();
        if (clientKey && megacloudKey) {
            const v3Url = `https://megacloud.blog/embed-2/v3/e-1/getSources?id=${videoId}&_k=${clientKey}`;
            const res = await tauriFetch(v3Url, { headers: { ...HEADERS, 'X-Requested-With': 'XMLHttpRequest', 'Referer': embedUrl } });
            if (res.status === 200) {
                const data = await res.json();
                let sources;
                if (data.encrypted && typeof data.sources === 'string') {
                    const decrypted = decryptSrc2(data.sources, clientKey, megacloudKey);
                    sources = JSON.parse(decrypted);
                } else if (Array.isArray(data.sources)) {
                    sources = data.sources;
                } else { throw new Error('No valid sources'); }
                return {
                    sources: sources.map((s) => ({
                        url: s.file || s.url,
                        quality: s.quality || 'auto',
                        isM3U8: (s.file || s.url || '').includes('.m3u8') || s.type === 'hls'
                    })),
                    subtitles: data.tracks?.filter((t) => t.kind === 'captions')?.map((t) => ({ url: t.file, lang: t.label })),
                    headers: { 'Referer': 'https://megacloud.blog/', 'Origin': 'https://megacloud.blog', 'User-Agent': HEADERS['User-Agent'] }
                };
            }
        }
        return null;
    } catch (e) { console.error('[HiAnime] Extraction failed:', e); return null; }
}
// ========== Main Extension ==========
return {
    id: 'hianime',
    name: 'HiAnime',
    baseUrl: 'https://hianime.to',
    lang: 'en',
    version: '2.1.0',
    iconUrl: 'https://hianime.to/favicon.ico',
    async search(filter) {
        const query = filter.query || '';
        const page = filter.page || 1;
        const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}&page=${page}`;
        console.log(`[HiAnime] Searching: ${url}`);
        const response = await tauriFetch(url, { method: 'GET', headers: HEADERS });
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const anime = [];
        doc.querySelectorAll('.film_list-wrap > .flw-item').forEach(item => {
            const link = item.querySelector('.film-detail .film-name a');
            const img = item.querySelector('.film-poster > img');
            if (link) {
                const href = link.getAttribute('href') || '';
                const id = href.split('/').pop()?.split('?')[0] || '';
                anime.push({ id, title: link.textContent?.trim() || 'Unknown', coverUrl: img?.getAttribute('data-src') || img?.getAttribute('src') || '', status: 'unknown' });
            }
        });
        return { anime, hasNextPage: !!doc.querySelector('.pagination .page-link[rel="next"]') };
    },
    async getAnimeInfo(animeId) {
        const url = `${this.baseUrl}/${animeId}`;
        console.log(`[HiAnime] Fetching details: ${url}`);
        const response = await tauriFetch(url, { method: 'GET', headers: HEADERS });
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return {
            id: animeId,
            title: doc.querySelector('.anisc-detail .film-name')?.textContent?.trim() || 'Unknown',
            coverUrl: doc.querySelector('.film-poster img')?.getAttribute('src') || '',
            description: doc.querySelector('.film-description .text')?.textContent?.trim() || '',
            status: 'unknown'
        };
    },
    async getEpisodes(animeId) {
        const idParts = animeId.split('-');
        const numericId = idParts[idParts.length - 1];
        if (!numericId) throw new Error('Could not extract numeric ID');
        const ajaxUrl = `${this.baseUrl}/ajax/v2/episode/list/${numericId}`;
        console.log(`[HiAnime] Fetching episodes: ${ajaxUrl}`);
        const response = await tauriFetch(ajaxUrl, { method: 'GET', headers: { ...HEADERS, 'X-Requested-With': 'XMLHttpRequest' } });
        const data = await response.json();
        const doc = new DOMParser().parseFromString(data.html, 'text/html');
        const episodes = [];
        doc.querySelectorAll('.ss-list a').forEach(item => {
            const id = item.getAttribute('data-id') || '';
            const number = parseFloat(item.getAttribute('data-number') || '0');
            const title = item.getAttribute('title') || `Episode ${number}`;
            if (id) episodes.push({ id, number, title, isFiller: item.classList.contains('ssl-item-filler') });
        });
        return episodes;
    },
    async getEpisodeSources(episodeId, _server) {
        console.log(`[HiAnime] Getting sources for: ${episodeId}`);
        const serversUrl = `${this.baseUrl}/ajax/v2/episode/servers?episodeId=${episodeId}`;
        const serversResp = await tauriFetch(serversUrl, { headers: HEADERS });
        const serversData = await serversResp.json();
        const serversDoc = new DOMParser().parseFromString(serversData.html, 'text/html');
        const serverItems = Array.from(serversDoc.querySelectorAll('.server-item[data-type="sub"]'));
        if (serverItems.length === 0) throw new Error('No servers found');
        for (const serverEl of serverItems) {
            const serverId = serverEl.getAttribute('data-id');
            const serverName = serverEl.textContent?.trim() || 'Unknown';
            if (!serverId) continue;
            try {
                console.log(`[HiAnime] Trying server: ${serverName}`);
                const sourcesUrl = `${this.baseUrl}/ajax/v2/episode/sources?id=${serverId}`;
                const srcRes = await tauriFetch(sourcesUrl, { headers: HEADERS });
                const srcJson = await srcRes.json();
                if (!srcJson.link) continue;
                if (srcJson.type === 'iframe') {
                    console.log(`[HiAnime] Got iframe source: ${srcJson.link}`);
                    const extracted = await extractFromEmbed(srcJson.link);
                    if (extracted) return extracted;
                    continue;
                }
                if (srcJson.link.includes('.m3u8') || srcJson.link.includes('.mp4')) {
                    return { sources: [{ url: srcJson.link, quality: 'auto', isM3U8: srcJson.link.includes('.m3u8') }], headers: { 'Referer': this.baseUrl } };
                }
            } catch (e) { console.warn(`[HiAnime] Server ${serverName} failed:`, e); }
        }
        throw new Error('All servers failed');
    }
};