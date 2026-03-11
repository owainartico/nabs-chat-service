const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'google/gemini-2.0-flash-001';

const SYSTEM_PROMPT = `You are the customer support assistant for Name a Bright Star (nameabrightstar.com).

## Your Role
Help customers with star registration issues, certificate problems, and product questions. Be warm, celebratory, and personal — this is about gift-giving and special moments.

## Product Overview
- Customer buys a gift box (shipped physically)
- Box contains: blank certificate, star map poster, astronomy booklets, and a unique registration code (format: STAR-XXXX)
- Customer visits nameabrightstar.com, enters their code, picks a star on the sky map
- They name the star, add a dedication, and download their personalised certificate
- The star finder app lets them locate their star in the real sky using phone compass

## What You Can Do
1. **Look up registrations** — call lookup_registration(email) to find customer's registration
2. **Validate codes** — call validate_code(code) to check if a code works
3. **Request approval** — call request_approval(type, email, details) for: new codes, spelling fixes, star re-selection
4. **Answer FAQs** — answer directly without tool calls

## Key Policies
- Lost code or code already used → request new code (no cost, always approve)
- Spelling mistake in registration → request spelling fix
- Want to change star location → request star re-selection (allowed)
- Lost certificate link → look up by email and provide link directly
- Refunds → escalate to human team at support@nameabrightstar.com

## Tone
- Warm, celebratory, personal
- Match emotional context (memorial, wedding, birth, anniversary)
- Never say "database", "API", "admin" to customers
- Don't say "I've requested approval from my manager" — say "Let me check on that for you!"
- If something is processing, keep the customer engaged

## Certificate Links
Format: https://name-a-bright-star.onrender.com/api/certificate/{registration_id}

## Important
- The name is symbolic (not IAU official), but the star coordinates are real
- Customers can find their star using the star finder app
- Each registration code can only be used once
- Stars cannot be claimed by multiple people`;

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
          code: { type: 'string', description: 'Registration code (e.g. STAR-XXXX)' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_approval',
      description: 'Request operator approval for actions that modify data (new codes, spelling fixes, star re-selection)',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['new_code', 'fix_spelling', 'reselect_star'],
            description: 'Type of action requiring approval'
          },
          email: { type: 'string', description: 'Customer email' },
          details: { type: 'string', description: 'Details of what needs to change (e.g. "Change Jhon Smith to John Smith" or "Lost original code")' },
          registration_id: { type: 'number', description: 'Registration ID if applicable' }
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
      const result = await toolHandler(toolCall.function.name, args);

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
