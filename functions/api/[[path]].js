// 文档持久化 API — CF Pages Functions

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function checkAuth(request, env) {
  const token = (request.headers.get("Authorization") || "").replace("Bearer ", "");
  return token === (env.ACCESS_PASSWORD || "shaduanduan123");
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace("/api", "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  if (!checkAuth(request, env)) return json({ success: false, error: "未授权" }, 401);

  try {
    // GET /api/docs — 文档列表（含 folder）
    if (path === "/docs" && request.method === "GET") {
      const result = await env.DB.prepare("SELECT id, title, folder, created_at, updated_at FROM documents ORDER BY folder ASC, updated_at DESC").all();
      return json({ success: true, data: result.results });
    }

    // POST /api/docs — 新建文档
    if (path === "/docs" && request.method === "POST") {
      const body = await request.json();
      const title = body.title || "无标题";
      const content = body.content || "";
      const folder = body.folder || "默认";
      const result = await env.DB.prepare(
        "INSERT INTO documents (title, content, folder) VALUES (?, ?, ?)"
      ).bind(title, content, folder).run();
      return json({ success: true, data: { id: result.meta.last_row_id } });
    }

    const match = path.match(/^\/docs\/(\d+)$/);

    // GET /api/docs/:id
    if (match && request.method === "GET") {
      const doc = await env.DB.prepare("SELECT * FROM documents WHERE id = ?").bind(parseInt(match[1])).first();
      if (!doc) return json({ success: false, error: "文档不存在" }, 404);
      return json({ success: true, data: doc });
    }

    // PUT /api/docs/:id
    if (match && request.method === "PUT") {
      const body = await request.json();
      const fields = [];
      const binds = [];
      if (body.title !== undefined) { fields.push("title = ?"); binds.push(body.title); }
      if (body.content !== undefined) { fields.push("content = ?"); binds.push(body.content); }
      if (body.folder !== undefined) { fields.push("folder = ?"); binds.push(body.folder); }
      if (!fields.length) return json({ success: false, error: "没有要更新的字段" }, 400);
      fields.push("updated_at = datetime('now')");
      binds.push(parseInt(match[1]));
      await env.DB.prepare(`UPDATE documents SET ${fields.join(", ")} WHERE id = ?`).bind(...binds).run();
      return json({ success: true });
    }

    // DELETE /api/docs/:id
    if (match && request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(parseInt(match[1])).run();
      return json({ success: true });
    }

    // POST /api/docs/import
    if (path === "/docs/import" && request.method === "POST") {
      const body = await request.json();
      if (!Array.isArray(body)) return json({ success: false, error: "需要文档数组" }, 400);
      let imported = 0;
      for (const doc of body) {
        if (!doc.content) continue;
        const title = doc.title || doc.content.split("\n")[0].replace(/^#+\s*/, "").slice(0, 50) || "无标题";
        const folder = doc.folder || "导入";
        await env.DB.prepare("INSERT INTO documents (title, content, folder) VALUES (?, ?, ?)").bind(title, doc.content, folder).run();
        imported++;
      }
      return json({ success: true, imported });
    }

    // GET /api/docs/export
    if (path === "/docs/export" && request.method === "GET") {
      const result = await env.DB.prepare("SELECT * FROM documents ORDER BY folder ASC, updated_at DESC").all();
      return json({ success: true, data: result.results });
    }

    // GET /api/search?q=关键词 — 搜索文档标题和正文
    if (path === "/search" && request.method === "GET") {
      const q = url.searchParams.get("q") || "";
      if (!q.trim()) return json({ success: false, error: "缺少搜索关键词 q" }, 400);
      const keyword = `%${q.trim()}%`;
      const result = await env.DB.prepare(
        "SELECT id, title, folder, substr(content, 1, 200) as preview, created_at, updated_at FROM documents WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC"
      ).bind(keyword, keyword).all();
      return json({ success: true, data: result.results, total: result.results.length });
    }

    return json({ success: false, error: "未找到路由: " + path }, 404);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}
