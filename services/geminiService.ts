import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { Attachment, AuditResult } from "../types";

const SYSTEM_INSTRUCTION = `
Você é o LuminaFlow AI, um especialista sênior em Frontend e UX/UI Design.
Sua tarefa é gerar código HTML único e completo para Landing Pages modernas e de alta conversão.

REGRAS RÍGIDAS:
1. Use APENAS Tailwind CSS via CDN para estilização. Não escreva CSS puro (<style>) a menos que seja estritamente necessário para animações personalizadas.
2. O design deve ser moderno, responsivo (mobile-first) e visualmente impactante.
3. Se o usuário pedir para alterar algo, mantenha o restante do código intacto e aplique apenas a alteração solicitada.
4. Responda APENAS com o código HTML completo.
5. Inclua <script src="https://cdn.tailwindcss.com"></script> no <head>.
6. Use imagens de placeholder do https://picsum.photos/ quando necessário.
7. NÃO explique o código. NÃO use blocos de markdown (\`\`\`html). Apenas retorne o código cru.
8. Certifique-se de que o contraste de cores seja acessível.

TRATAMENTO DE IMAGENS:
- Se o usuário pedir para "colocar uma foto X", mas não fornecer um link (URL), use um placeholder do picsum.photos e adicione um comentário HTML próximo à tag <img> instruindo o usuário a substituir o 'src' pelo link da imagem dele.
- Se o usuário fornecer uma URL de imagem no prompt, use-a diretamente no atributo 'src'.
- Se o usuário fizer upload de um arquivo (anexo) e pedir para usá-lo NO LAYOUT (não apenas como referência), explique brevemente em um comentário ou texto na página que ele deve hospedar a imagem e usar o link, pois arquivos locais não persistem no HTML estático gerado.

CONTEXTO DE ARQUIVOS:
Se o usuário fornecer uma imagem ou PDF, analise o estilo, layout, cores e conteúdo desse arquivo e use-o como referência principal para criar a página. Tente replicar a "vibe" e estrutura visual da referência.

Se for a primeira interação, crie uma estrutura completa de Landing Page baseada no prompt e nos arquivos fornecidos.
Se for uma interação subsequente, atualize o código HTML anterior com base no novo prompt.
`;

const AUDIT_SYSTEM_INSTRUCTION = `
Você é um Auditor Técnico Sênior (similar ao Google Lighthouse). 
Sua tarefa é analisar o código HTML fornecido e retornar um relatório JSON estrito sobre SEO, Acessibilidade e Performance.
Seja crítico mas construtivo.
O formato de resposta deve ser EXATAMENTE um JSON.
`;

// Função auxiliar para retry com backoff exponencial e tratamento de erro JSON
async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3, delay: number = 2000): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error: any) {
            const isLastAttempt = i === maxRetries - 1;
            
            // Converte erro para string para análise, mesmo se for objeto JSON
            let errorMsg = "";
            try {
                if (typeof error === 'string') errorMsg = error;
                else if (error instanceof Error) errorMsg = error.message;
                else errorMsg = JSON.stringify(error);
            } catch {
                errorMsg = "Unknown Error";
            }
            
            // Detecta erros que valem a pena tentar novamente (Rede, 500, Rate Limit temporário, XHR error)
            const isRetryable = 
                error?.status === 500 || 
                error?.status === 503 ||
                errorMsg.includes('500') || 
                errorMsg.includes('xhr error') || 
                errorMsg.includes('fetch failed') ||
                errorMsg.includes('network') ||
                errorMsg.includes('overloaded') ||
                errorMsg.includes('code: 6') || // gRPC code 6 (Unknown/Network)
                errorMsg.includes('RPC failed');

            if (!isRetryable || isLastAttempt) {
                console.error("Erro não recuperável ou limite de tentativas atingido:", errorMsg);
                throw error;
            }

            console.warn(`Tentativa ${i + 1} de ${maxRetries} falhou. Retentando em ${delay}ms... Erro:`, errorMsg);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Backoff exponencial
        }
    }
    throw new Error("Failed after max retries");
}

export const generateLandingPage = async (
  apiKey: string,
  prompt: string,
  currentHtml: string | null,
  attachment: Attachment | null,
  model: string = 'gemini-2.0-flash'
): Promise<string> => {
  if (!apiKey) throw new Error("Chave da API não configurada.");

  const ai = new GoogleGenAI({ apiKey });

  let fullPrompt = prompt;
  if (currentHtml) {
    fullPrompt = `
    CÓDIGO ATUAL:
    ${currentHtml}

    SOLICITAÇÃO DE ALTERAÇÃO:
    ${prompt}

    Retorne o HTML completo atualizado.
    `;
  }

  const parts: any[] = [];
  
  // Se houver anexo, adiciona como parte multimodal
  if (attachment) {
    parts.push({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.data
      }
    });
    fullPrompt += "\n\n(Use o arquivo anexado como referência visual/conteúdo)";
  }

  // Adiciona o prompt de texto
  parts.push({ text: fullPrompt });

  try {
    const response = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
      model: model,
      contents: parts,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    }));
    
    let text = response.text || "";
    
    // Limpeza de segurança
    text = text.replace(/```html/g, '').replace(/```/g, '').trim();

    return text;
  } catch (error) {
    console.error("Erro ao gerar landing page:", error);
    throw error;
  }
};

export const runNeuralAudit = async (apiKey: string, htmlCode: string, model: string = 'gemini-2.0-flash'): Promise<AuditResult> => {
    if (!apiKey) throw new Error("Chave da API não configurada.");
    const ai = new GoogleGenAI({ apiKey });
    
    try {
        const responseSchema = {
            type: Type.OBJECT,
            properties: {
                seoScore: { 
                    type: Type.NUMBER, 
                    description: "Nota de 0 a 100 para SEO" 
                },
                performanceScore: { 
                    type: Type.NUMBER, 
                    description: "Nota de 0 a 100 para Performance (estrutura, tamanho, scripts)" 
                },
                accessibilityScore: { 
                    type: Type.NUMBER, 
                    description: "Nota de 0 a 100 para Acessibilidade (contraste, ARIA, tags semânticas)" 
                },
                summary: { 
                    type: Type.STRING, 
                    description: "Um resumo geral curto da qualidade da página" 
                },
                suggestions: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            category: { 
                                type: Type.STRING
                            },
                            title: { 
                                type: Type.STRING 
                            },
                            description: { 
                                type: Type.STRING 
                            },
                            impact: { 
                                type: Type.STRING
                            }
                        }
                    }
                }
            }
        };

        const response = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
            model: model,
            contents: `Analise o seguinte código HTML e gere um relatório de auditoria em formato JSON:\n\n${htmlCode}`,
            config: {
                systemInstruction: AUDIT_SYSTEM_INSTRUCTION,
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        }));

        const jsonStr = response.text || "{}";
        return JSON.parse(jsonStr) as AuditResult;
    } catch (error) {
        console.error("Erro na Auditoria Neural:", error);
        throw error;
    }
};