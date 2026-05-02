// ==UserScript==
// @name        FAB Free Asset Getter
// @namespace   https://greasyfork.org/en/users/1443067-chaython
// @version     2.3.0
// @description A script to get all free assets from the FAB marketplace. Includes strict page redirection, auth protection, and cancel button.
// @author      Chaython
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
    var scriptIsRunning = false;
    var mainBtn = null;

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
        let cookies = document.cookie.split(";");
        for (let i = 0; i < cookies.length; i++) {
            let cookie = cookies[i].trim();
            if (cookie.startsWith("fab_csrftoken=")) {
                return cookie.split("=")[1];
            }
        }

        let metaToken = document.querySelector('meta[name="csrf-token"], meta[name="xsrf-token"]');
        if (metaToken) {
            return metaToken.getAttribute('content');
        }
        return "";
    }

    // Helper function to allow instant cancellation during long waits
    async function cancellableDelay(ms) {
        let elapsed = 0;
        while(elapsed < ms && scriptIsRunning) {
            await new Promise(r => setTimeout(r, 100));
            elapsed += 100;
        }
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
            return -1;
        }

        for (let item of items) {
            if (!scriptIsRunning) break; // Instantly stop if cancelled
            if (item.isOwned) continue;

            try {
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
                    console.warn(`[FAB Scraper] Skipped ${item.name} (Not actually free)`);
                    continue;
                }

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
                    console.error(`[FAB Scraper] 401 Unauthorized encountered.`);
                    showToast("Error 401: Session expired. Please refresh the page.", "error", 5000);
                    return -1;
                } else {
                     console.error(`[FAB Scraper] Failed to add ${item.name}. Status:`, addReq.status);
                }
            } catch (e) {
                console.error(`[FAB Scraper] Error processing ${item.name}:`, e);
            }

            await cancellableDelay(600);
        }
        return processedCount;
    }

    async function startLoop() {
        scriptIsRunning = true;

        // Update button to Cancel state
        mainBtn.textContent = "Cancel Script";
        mainBtn.style.backgroundColor = "#dc3545"; // Red
        showToast("Starting Auto-Scroll & Claim...", "success");

        let previousHeight = 0;
        let noChangeCount = 0;
        let totalAdded = 0;

        while(scriptIsRunning) {
            const currentItems = scanVisibleItems();
            console.log(`Scanned ${currentItems.length} items in current view`);

            const addedNow = await processItems(currentItems);

            if (addedNow === -1) {
                scriptIsRunning = false;
                mainBtn.textContent = "Failed. Refresh Page.";
                mainBtn.style.backgroundColor = "#dc3545";
                break;
            }

            if (!scriptIsRunning) break; // Check again in case it was cancelled mid-process

            totalAdded += addedNow;

            previousHeight = document.body.scrollHeight;
            window.scrollTo({ left: 0, top: document.body.scrollHeight, behavior: "smooth" });

            showToast(`Scrolling... (Session Total: ${totalAdded})`, "warning", 2000);
            await cancellableDelay(3000); // 3-second wait, but interruptible!

            if (!scriptIsRunning) break;

            let newHeight = document.body.scrollHeight;

            if (newHeight <= previousHeight) {
                noChangeCount++;
                window.scrollBy(0, -300);
                await cancellableDelay(500);
                window.scrollTo(0, document.body.scrollHeight);
                await cancellableDelay(2000);

                if (noChangeCount >= 4) {
                    showToast("Finished! No new items loading.", "success", 5000);
                    scriptIsRunning = false;
                    mainBtn.textContent = "Done!";
                    mainBtn.style.backgroundColor = "#45C761";
                    break;
                }
            } else {
                noChangeCount = 0;
            }
        }

        // Reset UI if it was manually cancelled
        if (mainBtn.textContent === "Stopping...") {
            showToast("Script Cancelled.", "warning");
            mainBtn.textContent = "Get Free Assets";
            mainBtn.style.backgroundColor = "#45C761";
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

        mainBtn = document.createElement("button");
        mainBtn.id = 'fab-auto-btn';

        // STRICT CHECK: Are we on the search page?
        const isSearchPage = window.location.pathname.startsWith("/search");

        if (!isSearchPage) {
            mainBtn.textContent = "Go to Free Search";
            mainBtn.style.backgroundColor = "#007bff";
        } else {
            mainBtn.textContent = "Get Free Assets";
            mainBtn.style.backgroundColor = "#45C761";
        }

        Object.assign(mainBtn.style, {
            position: "fixed", bottom: "80px", right: "20px", zIndex: "2147483647",
            padding: "12px 24px", color: "white",
            border: "2px solid white", borderRadius: "8px", fontWeight: "bold",
            cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", fontSize: "14px",
            fontFamily: "sans-serif"
        });

        mainBtn.onclick = () => {
            if (!isSearchPage) {
                // Instantly redirect to the correct page using the exact original URL structure
                window.location.href = "https://www.fab.com/search?&is_free=1";
            } else {
                if (!scriptIsRunning) {
                    startLoop();
                } else {
                    // Trigger the cancel sequence
                    scriptIsRunning = false;
                    mainBtn.textContent = "Stopping...";
                    mainBtn.style.backgroundColor = "#ffc107"; // Warning yellow
                }
            }
        };

        document.body.appendChild(mainBtn);
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        addControls();
    } else {
        window.addEventListener("DOMContentLoaded", addControls);
    }

})();
