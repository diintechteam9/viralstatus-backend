const puppeteer = require("puppeteer");

async function scrapeViews(urls = []) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  const results = [];

  for (const url of urls) {
    let data = {
      url,
      views: "N/A",
      likes: "N/A",
      comments: "N/A"
    };

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

      // Instagram Reel
      if (url.includes("instagram.com/reel")) {
        await page.waitForSelector("meta[property='og:video']", { timeout: 10000 });
        const reelData = await page.evaluate(() => {
          const scripts = Array.from(document.querySelectorAll("script"));
          const sharedScript = scripts.find(s =>
            s.textContent.includes("window._sharedData")
          );
          if (!sharedScript) return null;
          const jsonText = sharedScript.textContent.split(" = ")[1];
          const data = JSON.parse(jsonText.slice(0, -1));
          const media = data.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
          return {
            views: media?.video_view_count?.toString() || "Not Found",
            likes: media?.edge_media_preview_like?.count?.toString() || "Not Found",
            comments: media?.edge_media_to_comment?.count?.toString() || "Not Found"
          };
        });
        if (reelData) {
          data.views = reelData.views;
          data.likes = reelData.likes;
          data.comments = reelData.comments;
        }
      }
      // YouTube Shorts
      else if (url.includes("youtube.com/shorts")) {
        await page.waitForSelector("span.view-count, yt-formatted-string", { timeout: 10000 });
        const shortData = await page.evaluate(() => {
          const viewEl = document.querySelector("span.view-count") || document.querySelector("yt-formatted-string");
          const likeEl = document.querySelectorAll("ytd-toggle-button-renderer")[0]?.querySelector("#text");
          const commentEl = Array.from(document.querySelectorAll("yt-formatted-string"))
            .find(el => el.innerText.toLowerCase().includes("comment"));
          return {
            views: viewEl?.innerText || "Not Found",
            likes: likeEl?.innerText || "Not Found",
            comments: commentEl?.innerText || "Not Found"
          };
        });
        if (shortData) {
          data.views = shortData.views;
          data.likes = shortData.likes;
          data.comments = shortData.comments;
        }
      }
    } catch (err) {
      console.error(`❌ Error scraping ${url}:`, err.message);
    }

    results.push(data);
  }

  await browser.close();
  return results;
}

module.exports = { scrapeViews };