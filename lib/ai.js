const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'google/gemini-2.0-flash-001';

const SYSTEM_PROMPT = `You are the customer support assistant for Name a Bright Star (nameabrightstar.com).

## Your Role
Help customers with star registration issues, certificate problems, and product questions. Be warm, celebratory, and personal — this is about gift-giving and special moments.

## Product Overview
- Customer buys a gift box (shipped physically)
- Box contains: blank certificate, star map poster, astronomy booklets, and a unique registration code
- Customer visits nameabrightstar.com, enters their code, picks a star, names it, and downloads their certificate

## Tools — CALL THESE PROACTIVELY, do not just mention them in text

1. **lookup_registration(email)** — call this whenever a customer gives you their email
2. **validate_code(code)** — call this whenever a customer gives you a code
3. **request_approval(type, email, details)** — ALWAYS CALL THIS TOOL (do not just say you need approval):
   - type "new_code" → lost code, code already used, code not working
   - type "fix_spelling" → spelling mistake in star name or registrant name
   - type "reselect_star" → want a different star

## CRITICAL: When to call request_approval
- Customer says their code is lost or doesn't work → call request_approval with type "new_code"
- Customer wants to fix a typo in their star name → call request_approval with type "fix_spelling"
- Customer wants to change their star → call request_approval with type "reselect_star"
- NEVER just say "I'll request approval" — ALWAYS call the tool immediately

## Key Policies
- New codes are free and always approved — tell the customer it's on the way
- Refunds → escalate to human team at support@nameabrightstar.com

## Certificate Links
Format: https://register.nameabrightstar.com/star/{star_id}
(Use the star_id from the lookup_registration result, NOT the registration id)

## Tone
- Warm, celebratory, personal
- Match emotional context (memorial, wedding, birth, anniversary)
- Never say "database", "API", "admin"
- Never say "I've requested approval from my manager" — say "I've submitted that for you, it'll be sorted shortly!"
`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'lookup_registration',
      description: 'Look up a customer registration by their email address',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email address' }
        },
        required: ['email']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'validate_code',
      description: 'Check if a registration code is valid and unused',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Registration code' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_approval',
      description: 'ALWAYS call this tool when a customer needs a new code, spelling fix, or star re-selection. Do NOT just mention it — call it.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['new_code', 'fix_spelling', 'reselect_star'],
            description: 'Type of action'
          },
          email: { type: 'string', description: 'Customer email' },
          details: { type: 'string', description: 'What needs to change' },
          registration_id: { type: 'number', description: 'Registration ID if known' }
        },
        required: ['type', 'email', 'details']
      }
    }
  }
];

async function chat(messages, toolHandler) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nameabrightstar.com',
      'X-Title': 'NABS Support Chat'
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages
      ],
      tools: TOOLS,
      tool_choice: 'auto'
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const message = data.choices[0].message;

  // Handle tool calls
  if (message.tool_calls && message.tool_calls.length > 0) {
    const updatedMessages = [...messages, message];

    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      console.log('[AI] Tool call:', toolCall.function.name, JSON.stringify(args));
      const result = await toolHandler(toolCall.function.name, args);
      console.log('[AI] Tool result:', JSON.stringify(result).slice(0, 200));

      updatedMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      });
    }

    // Second pass with tool results
    return chat(updatedMessages, toolHandler);
  }

  return { content: message.content, messages: [...messages, message] };
}

module.exports = { chat };
