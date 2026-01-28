import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

interface PreviewFrameProps {
  html: string | null;
  isEditing?: boolean;
}

export interface PreviewFrameHandle {
  getHtml: () => string | undefined;
  enableEditMode: (enable: boolean) => void;
  updateElement: (data: any) => void;
}

const PreviewFrame = forwardRef<PreviewFrameHandle, PreviewFrameProps>(({ html, isEditing }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Expõe métodos para o componente pai
  useImperativeHandle(ref, () => ({
    getHtml: () => {
      if (iframeRef.current?.contentDocument) {
        // Remove os scripts de edição antes de salvar
        const doc = iframeRef.current.contentDocument;
        const style = doc.getElementById('editor-styles');
        if (style) style.remove();
        const script = doc.getElementById('editor-interactions');
        if (script) script.remove();
        
        return doc.documentElement.outerHTML;
      }
      return undefined;
    },
    updateElement: (data: any) => {
        const iframe = iframeRef.current;
        if(iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'AZUL_UPDATE', ...data }, '*');
        }
    },
    enableEditMode: (enable: boolean) => {
      const doc = iframeRef.current?.contentDocument;
      if (doc?.body) {
        
        // Injeta estilos visuais e scripts de interação
        if (enable) {
            if (!doc.getElementById('editor-styles')) {
                const style = doc.createElement('style');
                style.id = 'editor-styles';
                style.innerHTML = `
                    .azul-editable-highlight { outline: 2px dashed #3b82f6 !important; cursor: pointer !important; }
                    .azul-editable-selected { outline: 3px solid #3b82f6 !important; z-index: 9999; position: relative; }
                    body { cursor: default; }
                `;
                doc.head.appendChild(style);
            }

            if (!doc.getElementById('editor-interactions')) {
                const script = doc.createElement('script');
                script.id = 'editor-interactions';
                script.textContent = `
                    (function() {
                        let selectedEl = null;
                        
                        // ID generator helper
                        function generateUUID() {
                            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                                return v.toString(16);
                            });
                        }

                        // Add UUIDs to elements without ID for tracking
                        function ensureId(el) {
                            if (!el.getAttribute('data-azul-id')) {
                                el.setAttribute('data-azul-id', generateUUID());
                            }
                            return el.getAttribute('data-azul-id');
                        }

                        function handleMouseOver(e) {
                            e.stopPropagation();
                            e.target.classList.add('azul-editable-highlight');
                        }

                        function handleMouseOut(e) {
                            e.stopPropagation();
                            e.target.classList.remove('azul-editable-highlight');
                        }

                        function handleClick(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            if (selectedEl) {
                                selectedEl.classList.remove('azul-editable-selected');
                            }
                            
                            selectedEl = e.target;
                            selectedEl.classList.add('azul-editable-selected');
                            
                            const uuid = ensureId(selectedEl);
                            
                            // Send data to parent
                            window.parent.postMessage({
                                type: 'AZUL_CLICK',
                                tagName: selectedEl.tagName,
                                text: selectedEl.innerText,
                                src: selectedEl.src,
                                color: window.getComputedStyle(selectedEl).color,
                                bgColor: window.getComputedStyle(selectedEl).backgroundColor,
                                uuid: uuid
                            }, '*');
                        }

                        document.body.addEventListener('mouseover', handleMouseOver);
                        document.body.addEventListener('mouseout', handleMouseOut);
                        document.body.addEventListener('click', handleClick);

                        // Listen for updates from Parent
                        window.addEventListener('message', (e) => {
                            if (e.data.type === 'AZUL_UPDATE' && selectedEl) {
                                if (e.data.text !== undefined) selectedEl.innerText = e.data.text;
                                if (e.data.src !== undefined) selectedEl.src = e.data.src;
                                if (e.data.color !== undefined) selectedEl.style.color = e.data.color;
                                if (e.data.bgColor !== undefined) selectedEl.style.backgroundColor = e.data.bgColor;
                            }
                        });

                        // Cleanup function attached to window for removal
                        window.__azulCleanup = () => {
                            document.body.removeEventListener('mouseover', handleMouseOver);
                            document.body.removeEventListener('mouseout', handleMouseOut);
                            document.body.removeEventListener('click', handleClick);
                            if (selectedEl) selectedEl.classList.remove('azul-editable-selected');
                        };
                    })();
                `;
                doc.body.appendChild(script);
            }

        } else {
            // Disable Mode
            const style = doc.getElementById('editor-styles');
            if (style) style.remove();
            
            const script = doc.getElementById('editor-interactions');
            if (script) script.remove();

            // Call cleanup if exists
            if ((doc.defaultView as any)?.__azulCleanup) {
                (doc.defaultView as any).__azulCleanup();
            }
        }
      }
    }
  }));

  // Atualiza o conteúdo apenas se o HTML mudar externamente (não durante edição manual)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe && html && !isEditing) {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();
      }
    } else if (iframe && !html) {
        // Empty state
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if(doc) {
            doc.open();
            doc.write(`
                <html>
                    <body style="background-color: #0f172a; color: #64748b; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
                        <div style="text-align: center;">
                            <h2 style="margin-bottom: 8px;">Aguardando geração...</h2>
                            <p style="font-size: 14px;">Seu preview aparecerá aqui.</p>
                        </div>
                    </body>
                </html>
            `);
            doc.close();
        }
    }
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      title="Live Preview"
      className="w-full h-full bg-white rounded-lg shadow-inner"
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals" 
    />
  );
});

export default PreviewFrame;