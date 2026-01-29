// ==UserScript==
// @name        FAB Free Asset Getter
// @namespace   https://greasyfork.org/en/users/1443067-chaython
// @version     2.2.6
// @description A script to get all free assets from the FAB marketplace. Fixes the "Sort" button issue and adds robust Auto-Scrolling. Fork of the original by Noslipper (没拖鞋) & subtixx.
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
        return "";
    }

    // --- CORE LOGIC ---

    // 1. Scan the CURRENT visible part of the page for items
    function scanVisibleItems() {
        // Broad selectors to catch everything
        const allLinks = document.querySelectorAll("a[href*='/listings/']");

        let items = [];
        allLinks.forEach(link => {
            if(link.closest('footer')) return;

            const url = link.href;
            const id = url.split("/").pop();

            // --- UPDATED NAME PARSING LOGIC ---
            let title = "Unknown Asset";

            // Strategy 1: Check image alt text (Very reliable on FAB)
            const img = link.querySelector("img");
            if (img && img.alt && img.alt.length > 0) {
                title = img.alt;
            }
            // Strategy 2: Check standard headers inside the link
            else {
                const textNode = link.querySelector("[class*='Typography'], h3, h2, span.text");
                if (textNode && textNode.innerText.trim().length > 0) {
                    title = textNode.innerText.trim();
                }
                // Strategy 3: Check raw text of the link
                else if (link.innerText.trim().length > 0) {
                    title = link.innerText.trim();
                }
            }

            // Fallback: If title is still "Unknown Asset", use the ID so the user sees SOMETHING
            if (title === "Unknown Asset" && id) {
                title = `Asset #${id}`;
            }

            // Cleanup title (remove newlines)
            title = title.replace(/[\n\r]+/g, ' ').trim();
            // ----------------------------------

            // Helper to check if node is already owned
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

                items.push({
                    id: id,
                    name: title,
                    url: url,
                    isOwned: owned,
                    element: link
                });
            }
        });
        return items;
    }

    // 2. Process a specific list of items
    async function processItems(items) {
        let processedCount = 0;

        for (let item of items) {
            if (item.isOwned) continue;

            try {
                // A. Check details
                let detailsReq = await fetch(`https://www.fab.com/i/listings/${item.id}`, {
                    headers: { "X-CsrfToken": getCSRFToken(), "X-Requested-With": "XMLHttpRequest" }
                });
                if(!detailsReq.ok) continue;
                let details = await detailsReq.json();

                // Find free offer with Priority: Professional > Personal
                let freeOfferId = null;
                if(details.licenses) {
                    let professionalFree = null;
                    let standardFree = null;

                    for(let lic of details.licenses) {
                        if(lic.priceTier && lic.priceTier.price === 0) {
                            const name = (lic.name || "").toLowerCase();
                            // Check for professional keywords
                            if (name.includes("professional")) {
                                professionalFree = lic.offerId;
                            } else {
                                standardFree = lic.offerId;
                            }
                        }
                    }

                    // Select Professional if available, otherwise fallback to Standard/Personal
                    freeOfferId = professionalFree || standardFree;
                }

                if (!freeOfferId) continue;

                // B. Add to library
                showToast(`Adding: ${item.name}...`, "info", 1500);
                const formData = new FormData();
                formData.append("offer_id", freeOfferId);

                let addReq = await fetch(`https://www.fab.com/i/listings/${item.id}/add-to-library`, {
                    method: "POST",
                    headers: { "X-CsrfToken": getCSRFToken(), "X-Requested-With": "XMLHttpRequest" },
                    body: formData
                });

                if (addReq.ok) {
                    showToast(`Success: ${item.name}`, "success");
                    processedCount++;
                    // Mark visually as owned
                    item.element.style.border = "3px solid #45C761";
                    item.element.style.boxSizing = "border-box";
                }
            } catch (e) {
                console.error(e);
            }
            // Polite delay
            await new Promise(r => setTimeout(r, 600));
        }
        return processedCount;
    }

    // 3. MAIN LOOP
    async function startLoop() {
        showToast("Starting Auto-Scroll & Claim...", "success");

        let previousHeight = 0;
        let noChangeCount = 0;
        let totalAdded = 0;

        while(true) {
            const currentItems = scanVisibleItems();
            console.log(`Scanned ${currentItems.length} items in current view`);

            const addedNow = await processItems(currentItems);
            totalAdded += addedNow;

            previousHeight = document.body.scrollHeight;
            window.scrollTo({ left: 0, top: document.body.scrollHeight, behavior: "smooth" });

            showToast(`Scrolling... (Session Total: ${totalAdded})`, "warning", 2000);
            await new Promise(r => setTimeout(r, 3000));

            let newHeight = document.body.scrollHeight;

            if (newHeight <= previousHeight) {
                noChangeCount++;
                console.log(`Page height didn't change. Attempt ${noChangeCount}/3`);

                // Jiggle scroll to trigger observers
                window.scrollBy(0, -300);
                await new Promise(r => setTimeout(r, 500));
                window.scrollTo(0, document.body.scrollHeight);
                await new Promise(r => setTimeout(r, 2000));

                if (noChangeCount >= 4) {
                    showToast("Finished! No new items loading.", "success", 5000);
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

        // Check if we are on the homepage (or language variant homepages)
        const isHomePage = window.location.pathname === "/" || window.location.pathname === "/zh-cn";

        if (isHomePage) {
            btn.textContent = "Go to Free Search";
            btn.style.backgroundColor = "#007bff"; // Blue for navigation
        } else {
            btn.textContent = "Get Free Assets";
            btn.style.backgroundColor = "#45C761"; // Green for action
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
                // Redirect to search page with is_free=1
                window.location.href = "https://www.fab.com/search?&is_free=1";
            } else {
                // Run the scraper
                btn.disabled = true;
                btn.textContent = "Running... (Check Console)";
                btn.style.backgroundColor = "#e0e0e0";
                btn.style.color = "#666";
                btn.style.cursor = "default";
                startLoop();
            }
        };

        document.body.appendChild(btn);
        window.fabRun = startLoop;
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        addControls();
    } else {
        window.addEventListener("DOMContentLoaded", addControls);
    }

})();
