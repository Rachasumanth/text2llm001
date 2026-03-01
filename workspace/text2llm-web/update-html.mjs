import fs from 'fs';
const htmlPath = 'public/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

const newForm = `              <form id="idea-form" class="chat-input-area gemini-style">
                <textarea id="idea-input" placeholder="Ask anything about your project..." rows="1"></textarea>
                
                <div class="chat-input-toolbar">
                  <div class="chat-input-tools-left">
                    <button type="button" class="action-btn add-btn" title="Attach file">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                  </div>

                  <div class="chat-input-tools-right">
                    <!-- Model Selector -->
                    <div class="model-selector-wrapper" id="model-selector-wrapper">
                      <button type="button" class="model-selector-btn" id="model-selector-btn" title="Select model">
                        <span class="model-selector-icon" id="model-selector-icon">✦</span>
                        <span class="model-selector-label" id="model-selector-label">Model</span>
                        <span class="model-selector-chevron">▾</span>
                      </button>
                      <div class="model-selector-dropdown" id="model-selector-dropdown">
                        <div class="model-selector-loading">Loading providers…</div>
                      </div>
                    </div>

                    <button type="submit" class="action-btn submit-btn" id="send-btn" title="Send message">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                    </button>
                    <button type="button" class="action-btn stop-btn" id="stop-btn" title="Stop generating" style="display:none;">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    </button>
                  </div>
                </div>
              </form>`;

const regex = /<form id="idea-form"[^>]*>[\s\S]*?<\/form>/;
html = html.replace(regex, newForm);
fs.writeFileSync(htmlPath, html, 'utf8');
console.log("Updated HTML successfully");
