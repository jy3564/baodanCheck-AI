import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// 读取环境变量
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const openaiApiKey = process.env.OPENAI_API_KEY!;
const geminiApiKey = process.env.GEMINI_API_KEY!;

// 后端专用 Supabase client（用 service_role key）
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

// OpenAI & Gemini 客户端
const openai = new OpenAI({ apiKey: openaiApiKey });
const genAI = new GoogleGenerativeAI(geminiApiKey);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question: string = body.question;

    if (!question || question.trim().length === 0) {
      return NextResponse.json(
        { error: "问题不能为空" },
        { status: 400 }
      );
    }

    // 1. 对用户问题做 embedding
    const embResp = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: question,
    });

    const queryEmbedding = embResp.data[0].embedding;

    // 2. 调用 Supabase 的 match_policy_chunks 做向量检索
    const { data: chunks, error } = await supabaseAdmin.rpc(
      "match_policy_chunks",
      {
        query_embedding: queryEmbedding,
        match_count: 8,
        similarity_threshold: 0.7,
      }
    );

    if (error) {
      console.error("Supabase RPC error FULL OBJECT:", JSON.stringify(error, null, 2));
      return NextResponse.json(
        { error: "向量检索失败", details: error },
        { status: 500 }
      );
    }

    const contextText =
      (chunks ?? [])
        .map(
          (c: any, idx: number) =>
            `【片段${idx + 1} 来自保单：${c.policy_id} / 险种：${c.product_type || "未知"
            }】\n${c.chunk_text}`
        )
        .join("\n\n----\n\n") || "（未检索到相关保单片段）";

    // 3. 交给 Gemini 生成回答
    const model = genAI.getGenerativeModel({
      // 模型名可以根据你控制台支持情况调整
      model: "gemini-1.5-pro",
    });

    const prompt = `
你是一名严谨的保险顾问，请根据下面的保单条款片段来回答用户的问题。

要求：
- 先用通俗语言给出结论，再给出依据。
- 依据请引用“保单片段”的内容，但用自然语言复述，不要整段硬贴。
- 不要编造不存在的保险责任；不确定的地方请明确说“不确定，需要查原始保单”。

【用户问题】
${question}

【检索到的保单片段（可能来自不同公司的产品，仅供参考）】
${contextText}
    `.trim();

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    return NextResponse.json({
      answer: responseText,
      context: chunks ?? [],
    });
  } catch (err: any) {
    console.error("API /api/chat error:", err);
    return NextResponse.json(
      { error: "服务器内部错误" },
      { status: 500 }
    );
  }
}
