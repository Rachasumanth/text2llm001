// LiteGraph is already globally available via script tag

// Initialize LiteGraph
const graph = new LGraph();
const canvas = new LGraphCanvas("#mycanvas", graph);
// Set the visual aesthetics
canvas.background_color = "#1a1a1a";
canvas.default_link_color = "#64ffda";
canvas.highquality_render = true;
canvas.show_info = false; // Hide top-left info
canvas.always_render_background = true;

// Utility functions for Shape calculations
function parseShape(shapeStr) {
    if (!shapeStr) return null;
    try {
        // e.g., "[B, S, D]"
        return shapeStr.replace(/[\[\]\s]/g, "").split(",");
    } catch {
        return null;
    }
}

// ----------------------------------------------------
// Node Types Definition
// ----------------------------------------------------

// 1. INPUT NODE
class InputNode {
    constructor() {
        this.title = "Text Input / Tokenizer";
        this.addOutput("Tokens [B, S]", "tensor_shape");
        
        // Properties
        this.properties = { batch_size: 4, seq_length: 2048, vocab_size: 32000 };
        this.addWidget("number", "Batch Size (B)", this.properties.batch_size, (v) => { this.properties.batch_size = v; }, { min: 1, max: 256, step: 10, precision: 0 });
        this.addWidget("number", "Seq Len (S)", this.properties.seq_length, (v) => { this.properties.seq_length = v; }, { min: 128, max: 128000, step: 128, precision: 0 });
        this.addWidget("number", "Vocab Size", this.properties.vocab_size, (v) => { this.properties.vocab_size = v; }, { min: 1000, max: 150000, step: 1000, precision: 0 });
        
        this.size = [220, 100];
        this.color = "#2b5c47"; // green tint
    }
    
    onExecute() {
        this.setOutputData(0, {
            type: "tensor_shape",
            shape: `[${this.properties.batch_size}, ${this.properties.seq_length}]`,
            params: 0,
            activations: this.properties.batch_size * this.properties.seq_length // tokens
        });
    }
}
InputNode.title = "Input";
LiteGraph.registerNodeType("LLM/Input", InputNode);

// 2. EMBEDDINGS
class TokenEmbeddingNode {
    constructor() {
        this.title = "Token Embedding";
        this.addInput("Tokens [B, S]", "tensor_shape");
        this.addOutput("Embeds [B, S, D]", "tensor_shape");
        
        this.properties = { vocab_size: 32000, d_model: 4096 };
        this.addWidget("number", "Vocab Size", this.properties.vocab_size, (v) => { this.properties.vocab_size = v; }, { min: 1000, max: 150000, step: 1000, precision: 0 });
        this.addWidget("number", "Dimension (D)", this.properties.d_model, (v) => { this.properties.d_model = v; }, { min: 64, max: 16384, step: 64, precision: 0 });
        this.color = "#3d4c53";
    }
    onExecute() {
        const input = this.getInputData(0);
        let B = "B", S = "S";
        if (input && input.shape) {
            let parts = parseShape(input.shape);
            if(parts.length >= 2) { B = parts[0]; S = parts[1]; }
        }
        const params = this.properties.vocab_size * this.properties.d_model;
        const acts = (B !== "B" ? B : 1) * (S !== "S" ? S : 2048) * this.properties.d_model;

        this.setOutputData(0, {
            shape: `[${B}, ${S}, ${this.properties.d_model}]`,
            params: params,
            activations: acts
        });
    }
}
TokenEmbeddingNode.title = "Token Embeddings";
LiteGraph.registerNodeType("LLM/TokenEmbedding", TokenEmbeddingNode);

// 3. POSITIONAL EMBEDDINGS (RoPE)
class RoPENode {
    constructor() {
        this.title = "RoPE Positional";
        this.addInput("Input [B, S, D]", "tensor_shape");
        this.addOutput("Output [B, S, D]", "tensor_shape");
        this.properties = { base: 10000 };
        this.addWidget("number", "Theta Base", this.properties.base, (v) => { this.properties.base = v; }, { min: 10000, max: 500000, step: 10000, precision: 0 });
        this.color = "#3d4c53";
    }
    onExecute() {
        const input = this.getInputData(0);
        if (input) {
            this.setOutputData(0, {
                shape: input.shape,
                params: 0, // RoPE is mostly buffer/compute
                activations: input.activations || 0
            });
        }
    }
}
RoPENode.title = "RoPE Positional";
LiteGraph.registerNodeType("LLM/RoPE", RoPENode);

// 4. ATTENTION
class AttentionNode {
    constructor() {
        this.title = "Multi-Head Attention";
        this.addInput("Input [B, S, D]", "tensor_shape");
        this.addOutput("Output [B, S, D]", "tensor_shape");
        
        this.properties = { d_model: 4096, num_heads: 32, num_kv_heads: 8 }; // GQA by default
        this.addWidget("number", "Dim (D)", this.properties.d_model, (v) => { this.properties.d_model = v; }, { min: 64, max: 16384, step: 64, precision: 0 });
        this.addWidget("number", "Num Heads", this.properties.num_heads, (v) => { this.properties.num_heads = v; }, { min: 1, max: 128, step: 1, precision: 0 });
        this.addWidget("number", "KV Heads", this.properties.num_kv_heads, (v) => { this.properties.num_kv_heads = v; }, { min: 1, max: 128, step: 1, precision: 0 });
        
        this.size = [240, 120];
        this.color = "#5c3a2b"; // Reddish
    }
    onExecute() {
        const input = this.getInputData(0);
        
        // Params = Wq, Wk, Wv, Wo
        // Wq = D * D
        // Wk, Wv = D * (D / num_heads * num_kv_heads)
        // Wo = D * D
        const head_dim = this.properties.d_model / this.properties.num_heads;
        const wq = this.properties.d_model * this.properties.d_model;
        const wk = this.properties.d_model * (head_dim * this.properties.num_kv_heads);
        const wv = this.properties.d_model * (head_dim * this.properties.num_kv_heads);
        const wo = this.properties.d_model * this.properties.d_model;
        const params = wq + wk + wv + wo;

        if (input) {
            this.setOutputData(0, {
                shape: input.shape,
                params: params,
                activations: input.activations * 4 // roughly Q,K,V,O
            });
        } else {
            this.setOutputData(0, { shape: `[B, S, ${this.properties.d_model}]`, params: params, activations: 0 });
        }
    }
}
AttentionNode.title = "Attention (MHA/GQA)";
LiteGraph.registerNodeType("LLM/Attention", AttentionNode);

// 5. MLP / SwiGLU
class SwiGLUNode {
    constructor() {
        this.title = "SwiGLU FFN";
        this.addInput("Input [B, S, D]", "tensor_shape");
        this.addOutput("Output [B, S, D]", "tensor_shape");
        
        this.properties = { d_model: 4096, hidden_dim: 14336 };
        this.addWidget("number", "Dim (D)", this.properties.d_model, (v) => { this.properties.d_model = v; }, { min: 64, max: 16384, step: 64, precision: 0 });
        this.addWidget("number", "Hidden Dim", this.properties.hidden_dim, (v) => { this.properties.hidden_dim = v; }, { min: 256, max: 65536, step: 256, precision: 0 });
        this.color = "#2b3b5c"; // Blueish
    }
    onExecute() {
        const input = this.getInputData(0);
        
        // Params = W_gate, W_up, W_down
        const params = 3 * (this.properties.d_model * this.properties.hidden_dim);

        if (input) {
            this.setOutputData(0, {
                shape: input.shape,
                params: params,
                activations: input.activations * (this.properties.hidden_dim / this.properties.d_model) * 3
            });
        } else {
            this.setOutputData(0, { shape: `[B, S, ${this.properties.d_model}]`, params: params, activations: 0 });
        }
    }
}
SwiGLUNode.title = "SwiGLU FFN";
LiteGraph.registerNodeType("LLM/SwiGLU", SwiGLUNode);

// 6. RMSNorm
class RMSNormNode {
    constructor() {
        this.title = "RMS Norm";
        this.addInput("Input", "tensor_shape");
        this.addOutput("Output", "tensor_shape");
        this.properties = { d_model: 4096 };
        this.addWidget("number", "Dim (D)", this.properties.d_model, (v) => { this.properties.d_model = v; }, { min: 64, max: 16384, step: 64, precision: 0 });
        this.color = "#5c5b2b";
    }
    onExecute() {
        const input = this.getInputData(0);
        if (input) {
            this.setOutputData(0, { shape: input.shape, params: this.properties.d_model, activations: input.activations });
        }
    }
}
RMSNormNode.title = "RMS Norm";
LiteGraph.registerNodeType("LLM/RMSNorm", RMSNormNode);

// 7. TRANSFORMER BLOCK (Macro Node)
class TransformerBlockNode {
    constructor() {
        this.title = "Transformer Block (xN)";
        this.addInput("Input [B, S, D]", "tensor_shape");
        this.addOutput("Output [B, S, D]", "tensor_shape");
        
        this.properties = { num_layers: 32, d_model: 4096, num_heads: 32, num_kv_heads: 8, hidden_dim: 14336 };
        this.addWidget("number", "Num Layers", this.properties.num_layers, (v) => { this.properties.num_layers = v; }, { min: 1, max: 128, step: 1, precision: 0 });
        this.addWidget("number", "Dim (D)", this.properties.d_model, (v) => { this.properties.d_model = v; }, { min: 64, max: 16384, step: 64, precision: 0 });
        this.addWidget("number", "Num Heads", this.properties.num_heads, (v) => { this.properties.num_heads = v; }, { min: 1, max: 128, step: 1, precision: 0 });
        this.addWidget("number", "KV Heads", this.properties.num_kv_heads, (v) => { this.properties.num_kv_heads = v; }, { min: 1, max: 128, step: 1, precision: 0 });
        this.addWidget("number", "FFN Hidden", this.properties.hidden_dim, (v) => { this.properties.hidden_dim = v; }, { min: 256, max: 65536, step: 256, precision: 0 });
        
        this.size = [260, 160];
        this.color = "#603c73"; // Purple
    }
    
    onExecute() {
        const input = this.getInputData(0);
        
        // Approx params for a single layer
        const head_dim = this.properties.d_model / this.properties.num_heads;
        const wq = this.properties.d_model * this.properties.d_model;
        const wk = this.properties.d_model * (head_dim * this.properties.num_kv_heads);
        const wv = this.properties.d_model * (head_dim * this.properties.num_kv_heads);
        const wo = this.properties.d_model * this.properties.d_model;
        const att_params = wq + wk + wv + wo;
        
        const ffn_params = 3 * (this.properties.d_model * this.properties.hidden_dim);
        const norm_params = 2 * this.properties.d_model; // 2 layernorms per block
        
        const layer_params = att_params + ffn_params + norm_params;
        const total_params = layer_params * this.properties.num_layers;

        if (input) {
            // Rough estimation of activation memory: 
            // In training, we save activations for each layer
            const layer_acts = input.activations * (4 /*att*/ + (this.properties.hidden_dim/this.properties.d_model)*3 /*ffn*/);
            
            this.setOutputData(0, {
                shape: input.shape,
                params: total_params,
                activations: layer_acts * this.properties.num_layers
            });
        }
    }
}
TransformerBlockNode.title = "Transformer Stack";
LiteGraph.registerNodeType("LLM/Transformer", TransformerBlockNode);

// 8. OUTPUT HEAD
class OutputNode {
    constructor() {
        this.title = "LM Head";
        this.addInput("Input [B, S, D]", "tensor_shape");
        this.properties = { vocab_size: 32000, d_model: 4096, tie_weights: false };
        this.addWidget("number", "Vocab Size", this.properties.vocab_size, (v) => { this.properties.vocab_size = v; }, { min: 1000, max: 150000, step: 1000, precision: 0 });
        this.addWidget("toggle", "Tie Weights", this.properties.tie_weights, (v) => { this.properties.tie_weights = v; });
        this.color = "#8a2c3a";
    }
    onExecute() {
        const input = this.getInputData(0);
        let params = 0;
        if (!this.properties.tie_weights) {
            params = this.properties.vocab_size * this.properties.d_model;
        }
        this.output_params = params;
        if (input) {
            this.output_activations = input.activations; 
        } else {
            this.output_activations = 0;
        }
    }
}
OutputNode.title = "LM Head";
LiteGraph.registerNodeType("LLM/Head", OutputNode);


// ----------------------------------------------------
// Physics Engine (VRAM & Params Calculator)
// ----------------------------------------------------

function formatLargeNumber(num, suffix="M") {
    if (num > 1e9) return (num / 1e9).toFixed(2) + " B";
    if (num > 1e6) return (num / 1e6).toFixed(2) + " M";
    if (num > 1000) return (num / 1000).toFixed(2) + " K";
    return num.toFixed(0);
}

function updatePhysics() {
    graph.runStep(); // force an execution step to propagate values
    
    let totalParams = 0;
    let totalActs = 0;
    
    const nodes = graph.computeExecutionOrder(false);
    for(const node of nodes) {
        if(node.outputs) {
            for(let i=0; i<node.outputs.length; ++i) {
                const data = node.getOutputData(i);
                if(data && data.params) {
                    totalParams += data.params;
                }
                if (data && data.activations) {
                    totalActs += data.activations;
                }
            }
        }
        if (node.type === "LLM/Head") {
            totalParams += (node.output_params || 0);
            totalActs += (node.output_activations || 0);
        }
    }

    // Estimating VRAM
    // 1 param in bf16 = 2 bytes
    // Adam Optimizer states = 8 bytes per param
    // Total param bytes = 2 + 8 = 10 bytes per param (Train)
    const paramBytes = totalParams * 10;
    
    // Activations (bf16) = 2 bytes per activation float
    // Need to account for batch_size * sequence_length implicitly inside `activations`
    const actBytes = totalActs * 2;
    
    const totalBytes = paramBytes + actBytes;
    
    const vramGB = totalBytes / (1024 * 1024 * 1024);

    document.getElementById("params-val").innerText = formatLargeNumber(totalParams);
    document.getElementById("vram-val").innerText = vramGB.toFixed(2) + " GB";
}

// Trigger physics update on graph change
graph.onGrapnodeAdd = () => setTimeout(updatePhysics, 10);
graph.onNodeAdded = () => setTimeout(updatePhysics, 10);
graph.onNodeConnectionChange = () => setTimeout(updatePhysics, 10);
graph.onNodeRemoved = () => setTimeout(updatePhysics, 10);

// Proxy widget value changes to trigger update
const origWidgetChange = LGraphNode.prototype.onPropertyChanged;
LGraphNode.prototype.onPropertyChanged = function(name, val) {
    if(origWidgetChange) origWidgetChange.call(this, name, val);
    setTimeout(updatePhysics, 10);
};

// Start default graph (Llama style representation)
const inNode = LiteGraph.createNode("LLM/Input");
inNode.pos = [100, 200];
graph.add(inNode);

const embNode = LiteGraph.createNode("LLM/TokenEmbedding");
embNode.pos = [400, 200];
graph.add(embNode);

const transformerNode = LiteGraph.createNode("LLM/Transformer");
transformerNode.pos = [700, 200];
graph.add(transformerNode);

const headNode = LiteGraph.createNode("LLM/Head");
headNode.pos = [1050, 200];
graph.add(headNode);

inNode.connect(0, embNode, 0);
embNode.connect(0, transformerNode, 0);
transformerNode.connect(0, headNode, 0);

graph.start();

// Handle Export
document.getElementById('export-btn').addEventListener('click', () => {
    const data = graph.serialize();
    console.log("Exported Architecture JSON:", data);
    
    // Typically we'd POST to a backend route for compiling.
    // For now, we simulate and show it.
    alert("Export successful! Graph JSON logged to console.\nReady to be compiled by Text2LLM Engine.");
});

// Resize canvas properly using ResizeObserver to handle iframe display changes
const container = document.getElementById("canvas-container");
const resizeObserver = new window.ResizeObserver(entries => {
    for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        if (width > 0 && height > 0) {
            canvas.resize(width, height);
            graph.setDirtyCanvas(true, true);
        }
    }
});
resizeObserver.observe(container);

setTimeout(() => {
    var rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        canvas.resize(rect.width, rect.height);
    }
    updatePhysics();
}, 100);
