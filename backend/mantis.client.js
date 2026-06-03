export default class MantisClient {
    constructor(baseUrl, apiToken) {
        const normalizedBaseUrl = baseUrl || '';
        this.baseUrl = normalizedBaseUrl.endsWith('/') ? normalizedBaseUrl.slice(0, -1) : normalizedBaseUrl;
        this.apiToken = apiToken || '';
    }

    ensureConfigured() {
        if (!this.baseUrl || !this.apiToken) {
            throw new Error('MANTIS_URL and MANTIS_API_TOKEN must be configured on the server.');
        }
    }

    async getHeader() {
        this.ensureConfigured();
        return {
            'Authorization': this.apiToken,
            'Content-Type': 'application/json'
        };
    }

    async checkConnection() {
        this.ensureConfigured();
        const url = `${this.baseUrl}/api/rest/users/me`;
        try {
            const response = await fetch(url, {
                headers: await this.getHeader()
            });
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`Mantis connection failed: ${response.status} - ${text}`);
            }
            try {
                return JSON.parse(text);
            } catch (parseErr) {
                const posMatch = parseErr.message.match(/position (\d+)/);
                const pos = posMatch ? parseInt(posMatch[1], 10) : 0;
                console.error(`[MantisClient] checkConnection JSON Parse Error at position ${pos}:`, text.substring(Math.max(0, pos - 50), pos + 50));
                // Try to find the first valid JSON object if there's trailing junk
                const firstBrace = text.indexOf('{');
                const lastBrace = text.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    try {
                        return JSON.parse(text.substring(firstBrace, lastBrace + 1));
                    } catch (innerErr) {
                        console.error('[MantisClient] Substring JSON parse failed too');
                    }
                }
                throw parseErr;
            }
        } catch (err) {
            console.error(`[MantisClient] Connection Error:`, err.message);
            throw err;
        }
    }

    async createIssue(issueData) {
        this.ensureConfigured();
        const url = `${this.baseUrl}/api/rest/issues`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: await this.getHeader(),
                body: JSON.stringify(issueData)
            });
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`Mantis issue creation failed: ${response.status} - ${text}`);
            }
            try {
                return JSON.parse(text);
            } catch (parseErr) {
                const posMatch = parseErr.message.match(/position (\d+)/);
                const pos = posMatch ? parseInt(posMatch[1], 10) : 0;
                console.error(`[MantisClient] JSON Parse Error at position ${pos}:`, text.substring(Math.max(0, pos - 50), pos + 50));
                // Try to find the first valid JSON object if there's trailing junk
                const firstBrace = text.indexOf('{');
                const lastBrace = text.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    try {
                        return JSON.parse(text.substring(firstBrace, lastBrace + 1));
                    } catch (innerErr) {
                        console.error('[MantisClient] Substring JSON parse failed too');
                    }
                }
                throw parseErr;
            }
        } catch (err) {
            console.error(`[MantisClient] Create Issue Error:`, err.message);
            throw err;
        }
    }

    async getIssue(issueId) {
        this.ensureConfigured();
        const url = `${this.baseUrl}/api/rest/issues/${issueId}`;
        try {
            const response = await fetch(url, {
                headers: await this.getHeader()
            });
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`Mantis fetch issue failed: ${response.status} - ${text}`);
            }
            try {
                return JSON.parse(text);
            } catch (parseErr) {
                const firstBrace = text.indexOf('{');
                const lastBrace = text.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    try {
                        return JSON.parse(text.substring(firstBrace, lastBrace + 1));
                    } catch (innerErr) {
                        console.error('[MantisClient] Substring JSON parse failed too');
                    }
                }
                throw parseErr;
            }
        } catch (err) {
            console.error(`[MantisClient] Get Issue Error:`, err.message);
            throw err;
        }
    }

    /**
     * Searches for existing tickets that might be duplicates within the last 7 days.
     * Match conditions: same signature, same src_ip, (same dest_ip OR target_host).
     */
    async findDuplicateTickets(fingerprint) {
        this.ensureConfigured();
        const { src_ip, dest_ip, target_host, signature, category } = fingerprint;
        
        // Fetch last 50 issues to check for recent duplicates
        const url = `${this.baseUrl}/api/rest/issues?page_size=50&page=1`;
        
        try {
            const response = await fetch(url, {
                headers: await this.getHeader()
            });
            
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`Mantis search failed: ${response.status} - ${text}`);
            }
            
            let data;
            try {
                data = JSON.parse(text);
            } catch (parseErr) {
                const firstBrace = text.indexOf('{');
                const lastBrace = text.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    data = JSON.parse(text.substring(firstBrace, lastBrace + 1));
                } else {
                    throw parseErr;
                }
            }

            const issues = data.issues || [];
            
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            const duplicates = issues.filter(issue => {
                const createdAt = new Date(issue.created_at);
                if (createdAt < sevenDaysAgo) return false;

                const content = `${issue.summary} ${issue.description || ''}`.toLowerCase();
                
                // Match Logic
                const matchesIp = src_ip && content.includes(src_ip.toLowerCase());
                const matchesSig = signature && content.includes(signature.toLowerCase());
                const matchesDest = (dest_ip && content.includes(dest_ip.toLowerCase())) || 
                                   (target_host && content.includes(target_host.toLowerCase()));
                
                // For a duplicate, we want high confidence: IP + Signature + (Dest IP or Host)
                return matchesIp && matchesSig && matchesDest;
            });
            
            // Limit to max 20 as requested
            return duplicates.slice(0, 20).map(d => ({
                id: d.id,
                summary: d.summary,
                status: d.status.name,
                created_at: d.created_at,
                ticket_url: `${this.baseUrl}/view.php?id=${d.id}`
            }));
            
        } catch (err) {
            console.error(`[MantisClient] Duplicate Search Error:`, err.message);
            throw err;
        }
    }
}
