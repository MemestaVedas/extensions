/**
 * MangaReader.to Extension Bundle
 * 
 * This is a bundled JavaScript version of the MangaReader extension
 * for use with the PLAY-ON! dynamic extension system.
 */

return {
    id: 'mangareader',
    name: 'MangaReader',
    version: '1.0.0',
    baseUrl: 'https://mangareader.to',
    lang: 'en',

    async search(filter) {
        try {
            const query = filter.query || '';
            const page = filter.page || 1;
            const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}&page=${page}`;

            console.log('[MangaReader] Fetching search data:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://mangareader.to/'
                }
            });

            console.log('[MangaReader] Response status:', response.status);

            if (!response.ok) {
                console.error(`[MangaReader] Search fetch failed: ${response.status} ${response.statusText}`);
                return { manga: [], hasNextPage: false };
            }

            const html = await response.text();
            console.log('[MangaReader] HTML length:', html.length);

            if (html.includes('Just a moment') || html.includes('Checking your browser')) {
                console.error('[MangaReader] Cloudflare block detected!');
                return { manga: [], hasNextPage: false };
            }

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const results = [];

            // MangaReader uses .manga-poster class for manga cards in search results
            const mangaCards = Array.from(doc.querySelectorAll('.item-spc, .manga-poster'));
            console.log('[MangaReader] Found manga cards:', mangaCards.length);

            for (const card of mangaCards) {
                // Find the link to the manga page
                const link = card.querySelector('a[href*="mangareader.to/"]') || card.closest('a[href]') || card.querySelector('a');
                if (!link) continue;

                const href = link.getAttribute('href') || '';

                // Extract slug-id from URL like /one-piece-3
                const match = href.match(/\/([\w-]+-(\d+))$/);
                if (!match) continue;

                const id = match[1]; // e.g., "one-piece-3"

                // Title
                let title = '';
                const titleEl = card.querySelector('.manga-name, .film-name, h3 a, h2 a, .item-title');
                if (titleEl) {
                    title = titleEl.textContent?.trim() || '';
                }

                if (!title) {
                    // Try to get from alt or title attribute
                    const img = card.querySelector('img');
                    title = img?.getAttribute('alt') || img?.getAttribute('title') || '';
                }

                if (!title) {
                    // Extract from slug
                    title = id.replace(/-\d+$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                }

                // Cover image
                let coverUrl = '';
                const img = card.querySelector('img');
                if (img) {
                    coverUrl = img.getAttribute('data-src') || img.getAttribute('src') || '';
                }

                if (coverUrl && !coverUrl.startsWith('http')) {
                    coverUrl = new URL(coverUrl, this.baseUrl).href;
                }

                // Skip duplicates
                if (results.some(r => r.id === id)) continue;

                results.push({ id, title, coverUrl, status: 'unknown' });
                console.log(`[MangaReader] Found: ${title} (${id})`);
            }

            // Check for next page
            const hasNextPage = doc.querySelector('.pagination .page-link.active + .page-link') !== null ||
                doc.querySelector('.pagination-next') !== null;

            console.log('[MangaReader] Total results:', results.length);
            return { manga: results, hasNextPage };
        } catch (error) {
            console.error('[MangaReader] Search failed:', error);
            return { manga: [], hasNextPage: false };
        }
    },

    async getMangaDetails(id) {
        try {
            const url = `${this.baseUrl}/${id}`;
            console.log('[MangaReader] Fetching manga details:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://mangareader.to/'
                }
            });

            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            // Title
            const title = doc.querySelector('.manga-name, .anisc-detail h2, h1')?.textContent?.trim() ||
                id.replace(/-\d+$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

            // Cover
            let coverUrl = '';
            const posterImg = doc.querySelector('.manga-poster img, .film-poster img');
            if (posterImg) {
                coverUrl = posterImg.getAttribute('data-src') || posterImg.getAttribute('src') || '';
            }

            // Description
            const description = doc.querySelector('.description, .manga-description, .film-description')?.textContent?.trim() || '';

            // Author
            let author = '';
            const authorEl = doc.querySelector('.author a, [href*="/author/"]');
            if (authorEl) {
                author = authorEl.textContent?.trim() || '';
            }

            // Status
            let status = 'unknown';
            const statusEl = doc.querySelector('.status, .film-status');
            if (statusEl) {
                const statusText = statusEl.textContent?.toLowerCase() || '';
                if (statusText.includes('ongoing') || statusText.includes('publishing')) status = 'ongoing';
                else if (statusText.includes('completed') || statusText.includes('finished')) status = 'completed';
                else if (statusText.includes('hiatus')) status = 'hiatus';
                else if (statusText.includes('cancelled') || statusText.includes('discontinued')) status = 'cancelled';
            }

            return { id, title, coverUrl, description, author, status };
        } catch (error) {
            console.error('[MangaReader] Failed to get details:', error);
            throw error;
        }
    },

    async getChapters(mangaId) {
        try {
            const url = `${this.baseUrl}/${mangaId}`;
            console.log('[MangaReader] Fetching chapters from:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://mangareader.to/'
                }
            });

            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const chapters = [];

            // MangaReader chapter links are in format: /read/{manga-id}/en/chapter-{num}
            const chapterLinks = Array.from(doc.querySelectorAll('a[href*="/read/"][href*="/chapter-"]'));
            console.log('[MangaReader] Found chapter links:', chapterLinks.length);

            for (const link of chapterLinks) {
                const href = link.getAttribute('href') || '';

                // Extract chapter info from URL like /read/one-piece-3/en/chapter-1168
                const match = href.match(/\/read\/([\w-]+)\/([\w-]+)\/chapter-([\d.]+)/);
                if (!match) continue;

                const chapterId = `${match[1]}::${match[2]}::chapter-${match[3]}`; // manga-id::lang::chapter-num (URL-safe)
                const number = parseFloat(match[3]);

                // Skip duplicates
                if (chapters.some(c => c.id === chapterId)) continue;

                // Get title from link text
                let title = link.textContent?.trim() || `Chapter ${number}`;

                // Clean up title
                if (title.toLowerCase().includes('chap')) {
                    title = `Chapter ${number}`;
                }

                chapters.push({ id: chapterId, number, title });
            }

            // Sort by chapter number (descending - newest first)
            chapters.sort((a, b) => b.number - a.number);

            console.log('[MangaReader] Parsed chapters:', chapters.length);
            return chapters;
        } catch (error) {
            console.error('[MangaReader] Failed to get chapters:', error);
            return [];
        }
    },

    async getPages(chapterId) {
        try {
            // chapterId format: manga-id::lang::chapter-num (URL-safe, decode :: back to /)
            const decodedChapterId = chapterId.replace(/::/g, '/');
            const url = `${this.baseUrl}/read/${decodedChapterId}`;
            console.log('[MangaReader] Fetching pages from:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://mangareader.to/'
                }
            });

            const html = await response.text();
            console.log('[MangaReader] Pages HTML length:', html.length);

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const pages = [];

            // MangaReader loads images dynamically, but we can find them in the page container
            // Look for images in the reading container
            const images = Array.from(doc.querySelectorAll('.reading-content img, .container-reader img, .reader-main img, #readerarea img'));
            console.log('[MangaReader] Found reader images:', images.length);

            // If no images found in reader, try to find them in any img tag with manga-like sources
            let targetImages = images;
            if (targetImages.length === 0) {
                targetImages = Array.from(doc.querySelectorAll('img')).filter(img => {
                    const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
                    return src.includes('/chapter') || src.includes('/manga') || src.includes('/page');
                });
            }

            console.log('[MangaReader] Filtered images:', targetImages.length);

            targetImages.forEach((img, index) => {
                let src = img.getAttribute('data-src') || img.getAttribute('src') || '';

                if (src && !src.startsWith('http')) {
                    src = new URL(src, this.baseUrl).href;
                }

                if (src && !src.includes('logo') && !src.includes('avatar') && !src.includes('icon')) {
                    pages.push({ index, imageUrl: src });
                }
            });

            // If still no pages, check for lazy-loaded images or data attributes
            if (pages.length === 0) {
                // Try to find image URLs in scripts or data attributes
                const scripts = doc.querySelectorAll('script');
                for (const script of scripts) {
                    const content = script.textContent || '';
                    // Look for image arrays in JavaScript
                    const imageMatch = content.match(/images["\s]*[:=]\s*\[(.*?)\]/s);
                    if (imageMatch) {
                        const urls = imageMatch[1].match(/https?:\/\/[^"'\s,]+/g);
                        if (urls) {
                            urls.forEach((url, index) => {
                                pages.push({ index, imageUrl: url });
                            });
                        }
                    }
                }
            }

            console.log('[MangaReader] Final pages count:', pages.length);
            return pages;
        } catch (error) {
            console.error('[MangaReader] Failed to get pages:', error);
            return [];
        }
    }
};
