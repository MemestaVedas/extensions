/**
 * ====================================================================
 * HIANIME EXTENSION (Scraper-based)
 * ====================================================================
 * 
 * HiAnime/Aniwatch anime source extension for PLAY-ON!
 * 
 * This extension scrapes hianime.to directly using the fetch API
 * provided by the extension loader (Tauri HTTP plugin).
 * 
 * NOTE: The Consumet API (api.consumet.org) is no longer publicly available.
 * This version uses direct scraping similar to the built-in extension.
 * ====================================================================
 */

// Capture the fetch parameter passed by the loader (Tauri HTTP)
const tauriFetch = fetch;

return {
    id: 'hianime',
    // ... rest of the code
    
    async search(filter) {
        // Use tauriFetch instead of fetch
        const response = await tauriFetch(url, { ... });
    }
    // Apply to ALL fetch calls in the file
};

return {
    id: 'hianime',
    name: 'HiAnime',
    baseUrl: 'https://hianime.to',
    lang: 'en',
    version: '2.0.0',
    iconUrl: 'https://hianime.to/favicon.ico',

    // Request headers to bypass basic protections
    _headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://hianime.to/'
    },

    /**
     * Parse HTML string into DOM (browser built-in)
     */
    _parseHTML(html) {
        return new DOMParser().parseFromString(html, 'text/html');
    },

    /**
     * Search for anime
     */
    async search(filter) {
        const query = filter.query || '';
        const page = filter.page || 1;

        console.log('[HiAnime] Searching:', query);

        try {
            const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}&page=${page}`;
            console.log('[HiAnime] Search URL:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: this._headers
            });

            if (!response.ok) {
                throw new Error(`Search failed: HTTP ${response.status}`);
            }

            const html = await response.text();
            const doc = this._parseHTML(html);

            const anime = [];
            const items = doc.querySelectorAll('.film_list-wrap > .flw-item');

            items.forEach(item => {
                const link = item.querySelector('.film-detail .film-name a');
                const img = item.querySelector('.film-poster > img');
                const typeEl = item.querySelector('.fdi-item');

                if (link) {
                    const href = link.getAttribute('href') || '';
                    // Extract ID from URL like /watch/anime-name-12345
                    const id = href.replace(/^\//, '').split('?')[0];
                    const title = link.textContent?.trim() || 'Unknown';
                    const coverUrl = img?.getAttribute('data-src') || img?.getAttribute('src') || '';
                    const type = typeEl?.textContent?.trim() || 'TV';

                    if (id && title) {
                        anime.push({
                            id,
                            title,
                            coverUrl,
                            type,
                            status: 'unknown'
                        });
                    }
                }
            });

            const hasNextPage = !!doc.querySelector('.pagination .page-link[rel="next"]');

            console.log(`[HiAnime] Found ${anime.length} results`);
            return {
                anime,
                hasNextPage
            };
        } catch (error) {
            console.error('[HiAnime] Search error:', error);
            // Return empty results instead of crashing
            return {
                anime: [],
                hasNextPage: false,
                error: error.message || 'Search failed - the site may be blocking requests from your network'
            };
        }
    },

    /**
     * Get anime details
     */
    async getAnimeInfo(animeId) {
        console.log('[HiAnime] Getting info for:', animeId);

        try {
            const url = `${this.baseUrl}/${animeId}`;
            console.log('[HiAnime] Info URL:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: this._headers
            });

            if (!response.ok) {
                throw new Error(`Failed to get anime info: HTTP ${response.status}`);
            }

            const html = await response.text();
            const doc = this._parseHTML(html);

            const title = doc.querySelector('.anisc-detail .film-name')?.textContent?.trim() || 'Unknown';
            const coverUrl = doc.querySelector('.film-poster img')?.getAttribute('src') || '';
            const description = doc.querySelector('.film-description .text')?.textContent?.trim() || '';

            // Get additional info
            const genres = [];
            doc.querySelectorAll('.anisc-info .item-list a').forEach(el => {
                const genre = el.textContent?.trim();
                if (genre) genres.push(genre);
            });

            return {
                id: animeId,
                title,
                coverUrl,
                description,
                genres,
                status: 'unknown'
            };
        } catch (error) {
            console.error('[HiAnime] GetAnimeInfo error:', error);
            throw error;
        }
    },

    /**
     * Get episode list
     */
    async getEpisodes(animeId) {
        console.log('[HiAnime] Getting episodes for:', animeId);

        try {
            // Extract numeric ID from animeId (e.g., "watch/anime-name-12345" -> "12345")
            const idParts = animeId.split('-');
            const numericId = idParts[idParts.length - 1];

            if (!numericId) {
                throw new Error('Could not extract numeric ID from: ' + animeId);
            }

            const ajaxUrl = `${this.baseUrl}/ajax/v2/episode/list/${numericId}`;
            console.log('[HiAnime] Episodes AJAX URL:', ajaxUrl);

            const response = await fetch(ajaxUrl, {
                method: 'GET',
                headers: {
                    ...this._headers,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get episodes: HTTP ${response.status}`);
            }

            const data = await response.json();
            const doc = this._parseHTML(data.html);
            const episodes = [];

            doc.querySelectorAll('.ss-list a').forEach(item => {
                const id = item.getAttribute('data-id') || '';
                const number = parseFloat(item.getAttribute('data-number') || '0');
                const title = item.getAttribute('title') || `Episode ${number}`;
                const isFiller = item.classList.contains('ssl-item-filler');

                if (id) {
                    episodes.push({ id, number, title, isFiller });
                }
            });

            console.log(`[HiAnime] Found ${episodes.length} episodes`);
            return episodes;
        } catch (error) {
            console.error('[HiAnime] GetEpisodes error:', error);
            return [];
        }
    },

    /**
     * Get streaming sources for an episode
     */
    async getEpisodeSources(episodeId, server) {
        console.log('[HiAnime] Getting sources for:', episodeId);

        try {
            // Get servers list
            const serversUrl = `${this.baseUrl}/ajax/v2/episode/servers?episodeId=${episodeId}`;
            const serversResp = await fetch(serversUrl, { headers: this._headers });
            const serversData = await serversResp.json();
            const serversDoc = this._parseHTML(serversData.html);

            const serverItems = Array.from(serversDoc.querySelectorAll('.server-item[data-type="sub"]'));
            if (serverItems.length === 0) {
                throw new Error('No servers found');
            }

            console.log(`[HiAnime] Found ${serverItems.length} servers`);

            // Try each server until one works
            for (const serverEl of serverItems) {
                const serverId = serverEl.getAttribute('data-id');
                const serverName = serverEl.textContent?.trim() || 'Unknown';
                if (!serverId) continue;

                try {
                    console.log(`[HiAnime] Trying server: ${serverName}`);
                    const sourcesUrl = `${this.baseUrl}/ajax/v2/episode/sources?id=${serverId}`;
                    const srcRes = await fetch(sourcesUrl, { headers: this._headers });
                    const srcJson = await srcRes.json();

                    if (!srcJson.link) continue;

                    // For iframe sources, we return the embed URL for further processing
                    if (srcJson.type === 'iframe') {
                        console.log(`[HiAnime] Got iframe source: ${srcJson.link}`);
                        // Return the embed URL - the player should handle extraction
                        return {
                            sources: [{
                                url: srcJson.link,
                                quality: 'embed',
                                isM3U8: false,
                                isEmbed: true
                            }],
                            headers: {
                                'Referer': this.baseUrl,
                                'User-Agent': this._headers['User-Agent']
                            }
                        };
                    }

                    // Direct link (rare but possible)
                    if (srcJson.link.includes('.m3u8') || srcJson.link.includes('.mp4')) {
                        return {
                            sources: [{
                                url: srcJson.link,
                                quality: 'auto',
                                isM3U8: srcJson.link.includes('.m3u8'),
                                isBackup: false
                            }],
                            headers: {
                                'Referer': this.baseUrl,
                                'User-Agent': this._headers['User-Agent']
                            }
                        };
                    }
                } catch (e) {
                    console.warn(`[HiAnime] Server ${serverName} failed:`, e);
                }
            }

            throw new Error('All servers failed');
        } catch (error) {
            console.error('[HiAnime] GetEpisodeSources error:', error);
            throw error;
        }
    }
};
