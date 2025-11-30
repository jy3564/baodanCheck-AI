import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// 环境变量
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const openaiApiKey = process.env.OPENAI_API_KEY!;
const geminiApiKey = process.env.GEMINI_API_KEY!;

// Supabase【后端专用，不会曝露到前端】
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

// OpenAI【生成embedding 】
const openai = new OpenAI({ apiKey: openaiApiKey });

// Gemini【生成回答用】
const genAI = new GoogleGenerativeAI(geminiApiKey);
const geminiModel = genAI.getGenerativeModel({
  model: "gemini-3-pro-preview",
});

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();

    if (!question) {
      return NextResponse.json({ error: "问题不能为空" }, { status: 400 });
    }

    // 生成查询向量
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: question,
    });
    const queryEmbedding = emb.data[0].embedding;

    // Supabase 进行向量检索
    const { data: chunks, error } = await supabaseAdmin.rpc(
      "match_policy_chunks",
      {
        query_embedding: queryEmbedding,
        match_count: 8,
        similarity_threshold: 0.7,
      }
    );

    if (error) {
      console.error("Supabase RPC error:", error);
      return NextResponse.json({ error: "向量检索失败" }, { status: 500 });
    }

    // 拼接上下文
    const context = (chunks ?? [])
      .map((c: any, idx: number) =>
        "【片段" +
          (idx + 1) +
          " | 保单：" +
          c.policy_id +
          " | 险种：" +
          (c.product_type || "未知") +
          "】\n\n" +
          c.chunk_text
      )
      .join("\n\n------\n\n");

    const prompt =
      "你是一名严谨的保险产品顾问，请根据以下保单条款内容回答用户的问题。\n\n【用户问题】\n" +
      question +
      "\n\n【检索到的保单条款片段】\n" +
      (context || "(没有找到相关内容)") +
      "\n\n请基于条款内容回答，并避免推新有不存在的内容。";

    // 调用 Gemini 生成回答
    const result = await geminiModel.generateContent(prompt);
    const answer = result.response.text();

    return NextResponse.json({ answer });
  } catch (e) {
    console.error("API /api/chat Error:", e);
    return NextResponse.json(
      { error: "服务器内部错误，请查看日志" },
      { status: 500 }
    );
  }
}
