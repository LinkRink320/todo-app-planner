const https = require("https");
const { env } = require("../config");

// HTTPリクエストヘルパー関数
function makeHttpsRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        } catch (error) {
          reject(new Error(`Parse error: ${error.message}`));
        }
      });
    });

    req.on("error", reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// OpenAI API呼び出し
async function callOpenAI(prompt, model = "gpt-3.5-turbo") {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured");
  }

  const options = {
    hostname: "api.openai.com",
    port: 443,
    path: "/v1/chat/completions",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
  };

  const data = {
    model,
    messages: [
      {
        role: "system",
        content:
          "あなたは優秀な生産性コーチです。ユーザーの1日の作業データを分析して、建設的で励ましのある振り返りコメントと明日への具体的なアドバイスを提供してください。日本語で回答してください。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    max_tokens: 800,
    temperature: 0.7,
  };

  try {
    const response = await makeHttpsRequest(options, data);
    return response.choices[0].message.content;
  } catch (error) {
    console.error("OpenAI API call failed:", error);
    throw error;
  }
}

// Anthropic API呼び出し
async function callAnthropic(prompt, model = "claude-3-haiku-20240307") {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("Anthropic API key not configured");
  }

  const options = {
    hostname: "api.anthropic.com",
    port: 443,
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
  };

  const data = {
    model,
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `あなたは優秀な生産性コーチです。以下のユーザーの1日の作業データを分析して、建設的で励ましのある振り返りコメントと明日への具体的なアドバイスを提供してください。日本語で回答してください。\n\n${prompt}`,
      },
    ],
  };

  try {
    const response = await makeHttpsRequest(options, data);
    return response.content[0].text;
  } catch (error) {
    console.error("Anthropic API call failed:", error);
    throw error;
  }
}

// Google Gemini API呼び出し
async function callGemini(prompt, model = "gemini-pro") {
  if (!env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured");
  }

  const options = {
    hostname: "generativelanguage.googleapis.com",
    port: 443,
    path: `/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  };

  const data = {
    contents: [
      {
        parts: [
          {
            text: `あなたは優秀な生産性コーチです。以下のユーザーの1日の作業データを分析して、建設的で励ましのある振り返りコメントと明日への具体的なアドバイスを提供してください。日本語で回答してください。\n\n${prompt}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800,
    },
  };

  try {
    const response = await makeHttpsRequest(options, data);
    return response.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error("Gemini API call failed:", error);
    throw error;
  }
}

// メインのAI呼び出し関数
async function generateAIReflection(reflectionData) {
  const { date, summary, tasks, timeEntries } = reflectionData;

  // プロンプトを構築
  const prompt = `
【日付】${date}

【タスク実績】
- 総タスク数: ${summary.total_tasks}
- 完了タスク: ${summary.completed_tasks}
- 未完了タスク: ${summary.failed_tasks}
- 完了率: ${
    summary.total_tasks > 0
      ? Math.round((summary.completed_tasks / summary.total_tasks) * 100)
      : 0
  }%

【作業時間実績】
- 総作業時間: ${Math.floor(summary.total_work_time / 60)}時間${
    summary.total_work_time % 60
  }分
- 作業セッション数: ${summary.work_sessions}
- 平均セッション時間: ${
    summary.work_sessions > 0
      ? Math.round(summary.total_work_time / summary.work_sessions)
      : 0
  }分

【完了したタスク】
${tasks
  .filter((t) => t.status === "done")
  .map(
    (t) =>
      `- ${t.title}${
        t.estimated_minutes
          ? ` (見積:${t.estimated_minutes}分, 実績:${t.actual_minutes || 0}分)`
          : ""
      }`
  )
  .join("\n")}

【未完了のタスク】
${tasks
  .filter((t) => t.status === "failed")
  .map((t) => `- ${t.title}${t.deadline ? ` (期限:${t.deadline})` : ""}`)
  .join("\n")}

【作業パターン】
${timeEntries
  .slice(0, 5)
  .map((te) => {
    const start = new Date(te.start_time);
    const end = te.end_time ? new Date(te.end_time) : null;
    return `- ${start.getHours()}:${start
      .getMinutes()
      .toString()
      .padStart(2, "0")}${
      end
        ? ` - ${end.getHours()}:${end.getMinutes().toString().padStart(2, "0")}`
        : ""
    } ${te.task_title || "タスク"} (${te.duration_minutes || 0}分)`;
  })
  .join("\n")}

この1日の振り返りと明日への改善アドバイスをお願いします。
`;

  try {
    // 設定されたAIプロバイダーに基づいて呼び出し
    switch (env.AI_PROVIDER) {
      case "openai":
        return await callOpenAI(prompt, env.AI_MODEL);
      case "anthropic":
        return await callAnthropic(prompt, env.AI_MODEL);
      case "gemini":
        return await callGemini(prompt, env.AI_MODEL);
      default:
        throw new Error(`Unsupported AI provider: ${env.AI_PROVIDER}`);
    }
  } catch (error) {
    console.error("AI reflection generation failed:", error);

    // フォールバック: シンプルなルールベース生成
    return generateSimpleReflection(reflectionData);
  }
}

// フォールバック用のシンプルな振り返り生成
function generateSimpleReflection(data) {
  const { date, summary, tasks, timeEntries } = data;

  let reflection = `📊 ${date} の振り返り\n\n`;

  // 完了状況の評価
  if (
    summary.completed_tasks === summary.total_tasks &&
    summary.total_tasks > 0
  ) {
    reflection += "🎉 素晴らしいです！今日は全てのタスクを完了できました。\n";
  } else if (
    summary.total_tasks > 0 &&
    summary.completed_tasks / summary.total_tasks >= 0.7
  ) {
    reflection += "👍 良い一日でした！多くのタスクを完了できています。\n";
  } else if (
    summary.failed_tasks > summary.completed_tasks &&
    summary.total_tasks > 0
  ) {
    reflection +=
      "⚠️ 今日は少し大変でしたね。明日はもう少しリラックスしたスケジュールを組んでみましょう。\n";
  }

  // 作業時間の分析
  const workHours = Math.floor(summary.total_work_time / 60);
  const workMins = summary.total_work_time % 60;
  if (summary.total_work_time > 0) {
    reflection += `\n⏱️ 今日の作業時間: ${workHours}時間${workMins}分\n`;

    if (summary.total_work_time > 480) {
      // 8時間以上
      reflection += "長時間お疲れさまでした。適度な休憩も大切です。\n";
    } else if (summary.total_work_time < 120) {
      // 2時間未満
      reflection +=
        "今日は軽めでしたね。明日はもう少し集中時間を増やせるかもしれません。\n";
    }
  }

  // 集中パターンの分析
  if (timeEntries.length > 0) {
    const avgSessionTime = Math.round(
      summary.total_work_time / summary.work_sessions
    );
    reflection += `\n🎯 平均集中時間: ${avgSessionTime}分\n`;

    if (avgSessionTime > 60) {
      reflection += "長時間集中できていますね！素晴らしい集中力です。\n";
    } else if (avgSessionTime < 15) {
      reflection +=
        "短いセッションが多いようです。25分間のポモドーロテクニックを試してみてはいかがでしょうか。\n";
    }
  }

  // 改善提案
  reflection += "\n💡 明日への提案:\n";
  if (summary.failed_tasks > 0) {
    reflection +=
      "• 失敗したタスクを見直して、より現実的な期限を設定してみましょう\n";
  }
  if (summary.work_sessions > 10) {
    reflection +=
      "• 作業の細切れが多いようです。まとまった時間を確保できると良いでしょう\n";
  }
  reflection += "• 今日の成果を振り返って、明日も良い一日にしましょう！\n";

  return reflection;
}

module.exports = {
  generateAIReflection,
  generateSimpleReflection,
};
