import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

// We no longer need GoogleGenAI here, we'll use a generic fetch
// import { GoogleGenAI } from "@google/genai";

// const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();
const PORT = 3000;

app.use(express.json());

// A generic fetch function to proxy requests
async function proxyToLLM(apiConfig: any, payload: any) {
  const { url, key } = apiConfig;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
  }

  // Check if the response is JSON, otherwise return as text
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.indexOf("application/json") !== -1) {
    return response.json();
  } else {
    return response.text();
  }
}

// Dynamic Story Framework Generation Endpoint
app.post("/api/generate-story", async (req, res) => {
  try {
    const { playerName, playerProfile, apiConfig } = req.body;

    const generateStoryPrompt = `你的核心任务不是撰写一个固定的故事，而是根据输入的【玩家角色档案】，生成一套完整的、符合SCS流派×模型A判型逻辑的、可供程序执行的多线剧情框架。

【玩家角色档案】：
代号：${playerName}
自述设定：${playerProfile}

【你的工作流程】
1. 分析档案中的关键信息（如玩家自述的性格倾向、职业、背景）。
2. 从你的“风格库”中，智能选择一个最适合该档案的剧本主风格，并融合1-2个流行叙事元素。
3. 生成一个包含8个章节、以及动态NPC阵容的完整剧情框架。不需要生成特定选项，选项将由玩家自由输入。
4. 整个框架必须严格遵循SCS模型A的判型逻辑，但所有判型意图必须隐藏在生动的剧情冲突中。
5. 最终输出为严格的JSON格式，便于前端游戏引擎解析和呈现。

【一、风格与元素库（你必须从中智能选择）】
剧本主风格库（选择一项为主）：
现代都市、克苏鲁神话、修仙世界、校园背景、古代皇宫生存、赛博朋克、末日废土、星际科幻
流行叙事元素库（选择1-2项融合）：
重生、穿越、复仇、系统/面板、预言/宿命、扮猪吃虎、反套路、规则怪谈

【二、SCS模型A判型要求（最高优先级）】
8个章节分别侧重考察以下维度（可混合次要维度）：
伦理 (Ethics：Fi/Fe)：涉及信任、背叛、共情、道德抉择、关系网。
逻辑 (Logic：Ti/Te)：涉及因果分析、系统漏洞、效率、规则博弈。
实感 (Sensing：Si/Se)：涉及细节观察、身体感受、权力压迫、资源掌控。
直觉 (Intuition：Ni/Ne)：涉及隐喻象征、未来预见、潜在联系、发散联想。

【返回JSON结构要求】（务必返回合规且可以直接被解析的JSON代码，不要有任何markdown转义，如下所示）：
{
  "game_title": "你生成的核心游戏标题",
  "world_setting": "详细的世界观背景设定",
  "npcs": [
    { "name": "NPC名", "description": "NPC设定", "socionics_type_hidden": "隐含类型(例如:LSI)", "initial_affection": 50 }
  ],
  "chapters": [
    {
      "chapter_id": 1,
      "chapter_title": "第X章标题",
      "opening_narrative": "开场叙事，将玩家代入情境",
      "scenario_description": "当下的具体场景和危机。必须促使玩家做出行动判断",
      "focus_dimension": "本章重点考察的模型A维度 (例如: 伦理 Fi/Fe)"
    }
  ] (必须严格包含8个章节)
}`;

    const payload = {
      model: apiConfig.model,
      messages: [{ role: "user", content: generateStoryPrompt }],
      response_format: { type: "json_object" }, // For OpenAI compatible APIs
      stream: false
    };

    const responseJson = await proxyToLLM(apiConfig, payload);
    
    // Assuming the response from the LLM is a JSON string inside a content field, e.g., { choices: [{ message: { content: '{...}' } }] }
    // This part might need adjustment depending on the exact response structure of the target API
    let storyData;
    if (typeof responseJson === 'string') {
        storyData = JSON.parse(responseJson);
    } else if (responseJson.choices && responseJson.choices[0].message.content) {
        storyData = JSON.parse(responseJson.choices[0].message.content);
    } else {
        // Fallback for other structures, like Gemini's direct JSON response
        storyData = responseJson;
    }

    res.json({ storyData });
  } catch (err: any) {
    console.error("Generate Story Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Process Player Action Endpoint
app.post("/api/process-action", async (req, res) => {
  try {
    const { playerAction, currentChapter, playerProfile, npcs, chatHistory, apiConfig } = req.body;

    const processActionPrompt = `你是一个TRPG游戏主持人(GM)，同时也是精通Socionics模型A的分析者。
根据玩家在当前情境下的行动描述，生成合理的剧情发展，并分析玩家的SCS模型A特征。

【当前章节背景】:
标题: ${currentChapter.chapter_title}
背景说明: ${currentChapter.scenario_description}
本章重点考察维度: ${currentChapter.focus_dimension}

【玩家角色设定】:
${playerProfile}

【主要NPC阵营】:
${npcs.map((n:any) => `${n.name} (隐含类型: ${n.socionics_type_hidden})`).join(', ')}

【历史对话摘要】:
${chatHistory.map((msg:any) => `${msg.role === 'user' ? '玩家行动' : '剧情/NPC'}: ${msg.content}`).join('\n')}

【当前玩家行动输入】:
${playerAction}

请根据玩家的行动，生成接下来的剧情发展，并分析玩家行动中体现的社会人格学(Socionics)特质。
注意：NPC的行为和台词会随好感度变化，但变化方式必须符合其类型特质。

【返回JSON结构要求】：
{
  "narrative_response": "你作为GM或者NPC对玩家行动的直接反馈（纯文本叙事）。不要包含任何判型内容，用作直接显示给玩家看的剧情文本",
  "npc_reactions": [
    { "name": "互动的NPC名", "reaction": "NPC的反应台词或行为", "affection_change": 5 (或-5等数值变化) }
  ],
  "scs_analysis": "（仅供系统后台记录的分析）请根据SCS流派而不是MBTI判断。推断其伦理(Ethics)、逻辑(Logic)、实感(Sensing)、直觉(Intuition)的位置、符合哪个类型，注意使用scs的判断方式而不是单纯看强度。比如：玩家这一举动体现了怎样的模型A区块特征（是Ego的自信还是Super-id的试探等）。",
  "vague_feedback": "充满诗意和谜语感的微小坐标更新隐喻(比如：你的潜意识重构了情感模块)。这句话将作为本回合结束时的系统提示语给玩家看。"
}`;

    const payload = {
      model: apiConfig.model,
      messages: [{ role: "user", content: processActionPrompt }],
      response_format: { type: "json_object" },
      stream: false
    };

    const responseJson = await proxyToLLM(apiConfig, payload);

    let responseData;
    if (typeof responseJson === 'string') {
        responseData = JSON.parse(responseJson);
    } else if (responseJson.choices && responseJson.choices[0].message.content) {
        responseData = JSON.parse(responseJson.choices[0].message.content);
    } else {
        responseData = responseJson;
    }

    res.json(responseData);
  } catch (err: any) {
    console.error("Process Action Error:", err);
    res.status(500).json({ error: err.message });
  }
});

import { promises as fs } from "fs";

// Final Analysis Report Endpoint
app.post("/api/analyze", async (req, res) => {
  try {
    const { playerProfile, playHistory, npcAffection, apiConfig } = req.body;

    // Read the master prompt file
    const systemPromptContent = await fs.readFile(path.join(__dirname, 'socionics_ai_prompt.txt'), 'utf-8');
    
    // playHistory now contains the concatenated text and analysis of all chapters
    const historyText = playHistory.map((h: any) => `
第${h.chapterId}章: ${h.chapterTitle}
玩家总行动文本: ${h.fullActionText}
后台SCS预判侧写: ${h.scsAnalysis}
剧情后果: ${h.consequence}
    `).join('\n');

    const analysisUserPrompt = `玩家初始自述：
${playerProfile}

剧情选择追踪日志与系统预判（包含SCS模型A判型依据）：
${historyText}

最终各类NPC（及其假定类型）好感度状态：
${Object.entries(npcAffection).map(([npc, score]) => `${npc}: ${score}`).join('\n')}
(极度厌恶为负值)

任务：
请你扮演一位精通SCS流派与古典模型A的Socionics专家。基于上述全过程隐秘收集的数据，为玩家撰写一份深层的认知类型分析报告。

【硬性要求】：
1. 坚决排除任何MBTI词汇。必须严格使用Socionics模型A的理论术语（例如：Ego/Super-Ego/Super-Id/Id区块结构，Mental(意识轨道)/Vital(潜意识轨道)，维度高低，或信息元素符号如Ti, Te, Fe, Fi, Se, Si, Ne, Ni）。务必注意使用scs的判断方式，分析功能在模型中的位置（而不是单纯看强度）。
2. 文字风格必须是一位深邃、客观的专家在进行人格解构，带有赛博朋克深层剖析的氛围。不要输出直白的数字评分或轻浮的网发言论。
3. 玩家在游玩时输入了自由文本。请根据他们的轨迹：
   - 评估其在处理困境时，哪些信息元素表现出了高维度（3D/4D，游刃有余、创新），哪些落在了痛点区块（如Super-Ego的一维/二维限制）。
   - 对比【玩家初始自述】和【实际行为】，指出其自我认知与模型A本我/超我区块可能存在的落差。
   - 类间关系反推：依据玩家与NPC互动导致的最终好感度数值关系，推断该玩家与这三者的类间关系（例如：对冲、幻觉、双重、超我等），以佐证玩家最终可能的类型。
4. 在报告的最后，给出 1-2种 最有根据的可能社会人格类型（如 ILI，EIE等全称缩写），并给出其心理认知结构上的发展建议。

请直接输出评测长文，纯排版文本（可使用Markdown小标题）。字数800-1200字即可。`;

    const payload = {
      model: apiConfig.model,
      messages: [
        { role: "system", content: systemPromptContent },
        { role: "user", content: analysisUserPrompt }
      ],
      stream: false
    };

    const responseJson = await proxyToLLM(apiConfig, payload);

    let analysisText;
    if (typeof responseJson === 'string') {
        analysisText = responseJson;
    } else if (responseJson.choices && responseJson.choices[0].message.content) {
        analysisText = responseJson.choices[0].message.content;
    } else {
        // Handle cases where the response might be structured differently, e.g. Gemini Pro
        analysisText = responseJson.candidates[0].content.parts[0].text;
    }

    res.json({ analysisText });
  } catch (err: any) {
    console.error("Final Report Error:", err);
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
