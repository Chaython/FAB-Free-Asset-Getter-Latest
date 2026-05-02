// ==UserScript==
// @name        FAB Free Asset Getter (Fixed Auth)
// @namespace   https://greasyfork.org/en/users/1443067-chaython
// @version     2.2.8
// @description A script to get all free assets from the FAB marketplace. Includes 401 Auth protection and smart skipping.
// @author      Chaython (Updated by Coding Partner)
// @homepageURL https://github.com/Chaython/FAB-Free-Asset-Getter-Latest
// @supportURL  https://github.com/Chaython/FAB-Free-Asset-Getter-Latest/issues
// @match       https://www.fab.com/*
// @grant       none
// @license     AGPL-3.0-or-later
// @icon        https://www.google.com/s2/favicons?sz=64&domain=fab.com
// ==/UserScript==

(function () {
    `use strict`;
    var notificationQueueContainer = null;
    var scriptIsRunning = false; // Flag to help us stop the loop if needed

    // --- UTILS ---
    function showToast(message, type = 'success', duration = 3000) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.margin = "5px 0";
        toast.style.padding = '12px 16px';
        toast.style.backgroundColor = type === 'success' ? '#28a745' : (type === 'warning' ? '#ffc107' : '#dc3545');
        toast.style.color = type === 'warning' ? 'black' : 'white';
        toast.style.borderRadius = '6px';
        toast.style.zIndex = '10000';
        toast.style.fontFamily = 'Segoe UI, Roboto, Arial, sans-serif';
        toast.style.fontSize = '14px';
        toast.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        toast.style.maxWidth = '300px';
        toast.style.whiteSpace = 'nowrap';
        toast.style.overflow = 'hidden';
        toast.style.textOverflow = 'ellipsis';

        if(notificationQueueContainer) notificationQueueContainer.appendChild(toast);

        requestAnimationFrame(() => { toast.style.opacity = '1'; });

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, duration);
    }

    function getCSRFToken() {
        // Method 1: Check Cookies
        let cookies = document.cookie.split(";");
        for (let i = 0; i < cookies.length; i++) {
            let cookie = cookies[i].trim();
            if (cookie.startsWith("fab_csrftoken=")) {
                return cookie.split("=")[1];
            }
        }

        // Method 2: Check Meta Tags (Fallback)
        let metaToken = document.querySelector('meta[name="csrf-token"], meta[name="xsrf-token"]');
        if (metaToken) {
            return metaToken.getAttribute('content');
        }

        return "";
    }

    // --- CORE LOGIC ---
    function scanVisibleItems() {
        const allLinks = document.querySelectorAll("a[href*='/listings/']");
        let items = [];

        allLinks.forEach(link => {
            if(link.closest('footer')) return;

            const url = link.href;
            const id = url.split("/").pop();

            let title = "Unknown Asset";
            const img = link.querySelector("img");

            if (img && img.alt && img.alt.length > 0) {
                title = img.alt;
            } else {
                const textNode = link.querySelector("[class*='Typography'], h3, h2, span.text");
                if (textNode && textNode.innerText.trim().length > 0) {
                    title = textNode.innerText.trim();
                } else if (link.innerText.trim().length > 0) {
                    title = link.innerText.trim();
                }
            }

            if (title === "Unknown Asset" && id) {
                title = `Asset #${id}`;
            }

            title = title.replace(/[\n\r]+/g, ' ').trim();

            const isOwned = (node) => {
                const text = node.innerText || node.textContent || "";
                const parentText = node.parentElement ? node.parentElement.innerText : "";
                return (text.includes("Saved in My Library") ||
                        text.includes("已保存") ||
                        parentText.includes("Saved in My Library"));
            };

            if (id && !items.some(x => x.id === id)) {
                const card = link.closest("div[class*='Card'], div[class*='Stack']") || link.parentElement;
                const owned = isOwned(card || link);

                items.push({ id: id, name: title, url: url, isOwned: owned, element: link });
            }
        });
        return items;
    }

    async function processItems(items) {
        let processedCount = 0;
        const currentToken = getCSRFToken();

        if (!currentToken) {
            console.error("[FAB Scraper] CRITICAL: Could not find CSRF token.");
            showToast("Error: Security token missing. Please log in or refresh.", "error", 5000);
            return -1; // -1 indicates a fatal error to the main loop
        }

        for (let item of items) {
            if (!scriptIsRunning) break; // Allow emergency stop
            if (item.isOwned) continue;

            try {
                // A. Check details
                let detailsReq = await fetch(`https://www.fab.com/i/listings/${item.id}`, {
                    headers: { "X-CsrfToken": currentToken, "X-Requested-With": "XMLHttpRequest" }
                });

                if(!detailsReq.ok) continue;
                let details = await detailsReq.json();

                let freeOfferId = null;

                if(details.licenses && Array.isArray(details.licenses)) {
                    let professionalFree = null;
                    let standardFree = null;

                    for(let lic of details.licenses) {
                        const price = lic?.priceTier?.price;
                        const promoPrice = lic?.priceTier?.promotionalPrice;

                        if(price === 0 || price === "0" || promoPrice === 0 || promoPrice === "0") {
                            const name = (lic?.name || "").toLowerCase();

                            if (name.includes("professional")) {
                                professionalFree = lic.offerId || lic.id;
                            } else {
                                standardFree = lic.offerId || lic.id;
                            }
                        }
                    }
                    freeOfferId = professionalFree || standardFree;
                }

                if (!freeOfferId) {
                    console.warn(`[FAB Scraper] Skipped ${item.name} (Not actually free or no free license found)`);
                    continue;
                }

                // B. Add to library
                showToast(`Adding: ${item.name}...`, "info", 1500);
                const formData = new FormData();
                formData.append("offer_id", freeOfferId);

                let addReq = await fetch(`https://www.fab.com/i/listings/${item.id}/add-to-library`, {
                    method: "POST",
                    headers: { "X-CsrfToken": currentToken, "X-Requested-With": "XMLHttpRequest" },
                    body: formData
                });

                if (addReq.ok) {
                    showToast(`Success: ${item.name}`, "success");
                    processedCount++;
                    item.element.style.border = "3px solid #45C761";
                    item.element.style.boxSizing = "border-box";
                } else if (addReq.status === 401) {
                    console.error(`[FAB Scraper] 401 Unauthorized encountered. Session may have expired.`);
                    showToast("Error 401: Session expired. Please refresh the page.", "error", 5000);
                    return -1; // Halt processing on 401
                } else {
                     console.error(`[FAB Scraper] Failed to add ${item.name}. Status:`, addReq.status);
                }
            } catch (e) {
                console.error(`[FAB Scraper] Error processing ${item.name}:`, e);
            }

            await new Promise(r => setTimeout(r, 600));
        }
        return processedCount;
    }

    async function startLoop() {
        scriptIsRunning = true;
        showToast("Starting Auto-Scroll & Claim...", "success");

        let previousHeight = 0;
        let noChangeCount = 0;
        let totalAdded = 0;

        while(scriptIsRunning) {
            const currentItems = scanVisibleItems();
            console.log(`Scanned ${currentItems.length} items in current view`);

            const addedNow = await processItems(currentItems);

            // If processItems returns -1, we hit a critical auth error. Stop the script.
            if (addedNow === -1) {
                scriptIsRunning = false;
                document.getElementById('fab-auto-btn').textContent = "Failed. Refresh Page.";
                document.getElementById('fab-auto-btn').style.backgroundColor = "#dc3545"; // Red
                break;
            }

            totalAdded += addedNow;

            previousHeight = document.body.scrollHeight;
            window.scrollTo({ left: 0, top: document.body.scrollHeight, behavior: "smooth" });

            showToast(`Scrolling... (Session Total: ${totalAdded})`, "warning", 2000);
            await new Promise(r => setTimeout(r, 3000));

            let newHeight = document.body.scrollHeight;

            if (newHeight <= previousHeight) {
                noChangeCount++;
                window.scrollBy(0, -300);
                await new Promise(r => setTimeout(r, 500));
                window.scrollTo(0, document.body.scrollHeight);
                await new Promise(r => setTimeout(r, 2000));

                if (noChangeCount >= 4) {
                    showToast("Finished! No new items loading.", "success", 5000);
                    scriptIsRunning = false;
                    document.getElementById('fab-auto-btn').textContent = "Done!";
                    document.getElementById('fab-auto-btn').style.backgroundColor = "#45C761";
                    break;
                }
            } else {
                noChangeCount = 0;
            }
        }
    }

    // --- UI & INIT ---
    function addControls() {
        if(document.getElementById('fab-auto-btn')) return;

        notificationQueueContainer = document.createElement("div");
        Object.assign(notificationQueueContainer.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '10000',
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none'
        });
        document.body.appendChild(notificationQueueContainer);

        const btn = document.createElement("button");
        btn.id = 'fab-auto-btn';

        const isHomePage = window.location.pathname === "/" || window.location.pathname === "/zh-cn";

        if (isHomePage) {
            btn.textContent = "Go to Free Search";
            btn.style.backgroundColor = "#007bff";
        } else {
            btn.textContent = "Get Free Assets";
            btn.style.backgroundColor = "#45C761";
        }

        Object.assign(btn.style, {
            position: "fixed", bottom: "80px", right: "20px", zIndex: "2147483647",
            padding: "12px 24px", color: "white",
            border: "2px solid white", borderRadius: "8px", fontWeight: "bold",
            cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", fontSize: "14px",
            fontFamily: "sans-serif"
        });

        btn.onclick = () => {
            if (isHomePage) {
                window.location.href = "https://www.fab.com/search?&is_free=1";
            } else {
                btn.disabled = true;
                btn.textContent = "Running... (Check Console)";
                btn.style.backgroundColor = "#e0e0e0";
                btn.style.color = "#666";
                btn.style.cursor = "default";
                startLoop();
            }
        };

        document.body.appendChild(btn);
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        addControls();
    } else {
        window.addEventListener("DOMContentLoaded", addControls);
    }

})();
