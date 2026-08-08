import { graph } from "./meta-graph";

type PageInfo = {
  id: string;
  name: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    followers_count?: number;
    media_count?: number;
  };
};

export async function socialReport(opts: {
  token: string;
  platform?: "instagram" | "facebook" | "both";
  limit?: number;
}): Promise<string> {
  const which = opts.platform ?? "both";
  const postLimit = String(opts.limit ?? 10);
  const sections: string[] = [];

  try {
    const pages = await graph<{ data?: PageInfo[] }>("me/accounts", opts.token, {
      fields: "id,name,instagram_business_account{id,username,followers_count,media_count}",
    });
    const page = pages.data?.[0];
    if (!page) {
      return "No Facebook Page is accessible with this token. The system user token likely needs the 'pages_show_list' and 'pages_read_engagement' permissions — regenerate it including them.";
    }

    if (which !== "instagram") {
      try {
        const posts = await graph<{
          data?: {
            message?: string;
            created_time: string;
            shares?: { count: number };
            likes?: { summary?: { total_count: number } };
            comments?: { summary?: { total_count: number } };
          }[];
        }>(`${page.id}/posts`, opts.token, {
          fields: "message,created_time,shares,likes.summary(true),comments.summary(true)",
          limit: postLimit,
        });
        const rows = (posts.data ?? []).map((p) => {
          const text = (p.message ?? "(no text)").slice(0, 80).replace(/\n/g, " ");
          const likes = p.likes?.summary?.total_count ?? 0;
          const comments = p.comments?.summary?.total_count ?? 0;
          const shares = p.shares?.count ?? 0;
          return `- [${p.created_time.slice(0, 10)}] "${text}" — ${likes} likes, ${comments} comments, ${shares} shares`;
        });
        sections.push(`FACEBOOK — ${page.name}\n${rows.length ? rows.join("\n") : "No recent posts."}`);
      } catch (e) {
        sections.push(`FACEBOOK: error — ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (which !== "facebook") {
      const ig = page.instagram_business_account;
      if (!ig) {
        sections.push(
          "INSTAGRAM: not reachable through the Page. Either no IG business account is linked, or the token lacks 'instagram_basic' — regenerate it including it."
        );
      } else {
        try {
          const media = await graph<{
            data?: {
              caption?: string;
              media_type: string;
              like_count?: number;
              comments_count?: number;
              timestamp: string;
            }[];
          }>(`${ig.id}/media`, opts.token, {
            fields: "caption,media_type,like_count,comments_count,timestamp",
            limit: postLimit,
          });
          const rows = (media.data ?? []).map((m) => {
            const text = (m.caption ?? "(no caption)").slice(0, 80).replace(/\n/g, " ");
            return `- [${m.timestamp.slice(0, 10)}] ${m.media_type} "${text}" — ${m.like_count ?? 0} likes, ${m.comments_count ?? 0} comments`;
          });
          const header = `INSTAGRAM — @${ig.username ?? "?"} (${ig.followers_count?.toLocaleString() ?? "?"} followers, ${ig.media_count ?? "?"} posts)`;
          sections.push(`${header}\n${rows.length ? rows.join("\n") : "No recent media."}`);
        } catch (e) {
          sections.push(`INSTAGRAM: error — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } catch (e) {
    return `Meta API error: ${e instanceof Error ? e.message : String(e)}. If it mentions permissions, the token needs 'pages_show_list' / 'pages_read_engagement' / 'instagram_basic' — regenerate it including them.`;
  }

  return sections.join("\n\n");
}
