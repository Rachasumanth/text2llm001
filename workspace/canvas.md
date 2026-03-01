# Canvas: Visual LLM Parameter Editor - Implementation Plan

## 1. Overview

**Canvas** is a visual, node-based editor designed for real-time creation, modification, and evaluation of Large Language Model (LLM) architectures. It democratizes AI research by allowing users to drag and drop parameter blocks (e.g., Attention, MLP, Embeddings) rather than writing raw code, while providing instant physics-engine-style feedback on memory limits and compute requirements.

## 2. Core Architecture Stack

- **Frontend / Visual Canvas:** `LiteGraph.js` (or `React Flow`)
  - _Why:_ Provides smooth, 60FPS dragging, node connections, custom parameter sliders, and zoom/pan functionality similar to Unreal Engine Blueprints or ComfyUI.
- **Physics Engine (Validation & Physics):** Custom logic based on `LLM-Viewer` paradigms
  - _Why:_ Instantly calculates VRAM requirements, FLOPs, and parameter counts as the user connects nodes. It validates tensor shape matches and hardware limits in real-time.
- **Analytics & Metrics Viewer:** `ECharts` (or `D3.js`)
  - _Why:_ Renders real-time roofline charts, parameter distributions, and memory usage gauges in a side panel alongside the canvas.
- **Compiler & Exporter:** Custom JSON-to-PyTorch/Config Translator
  - _Why:_ Traverses the visual node graph, validates the execution order, and compiles the design into an executable `model.py` and `config.json` ready for PyTorch/HuggingFace training.

## 3. Component Breakdown

### 3.1 The Node Library (Palette)

Users can drag and drop the following functional nodes onto the canvas:

- **Input/Output Nodes:** Text Inputs, Tokenizer configurations, Output predictions (Logits/Softmax).
- **Core LLM Blocks:** Multi-Head Attention, Grouped-Query Attention (GQA), Sliding-Window Attention, SwiGLU FFN, MoE (Mixture of Experts) Router.
- **Layer Norms:** RMSNorm, standard LayerNorm.
- **Embeddings:** Positional (RoPE, ALiBi), standard Token Embeddings.

### 3.2 Real-time Feedback Loop

- **Shape Matching Validation:** Edges connecting nodes verify tensor shapes (e.g., `[batch, seq, embed_dim]`). Mismatched edges turn red and throw a visual warning.
- **Resource Gauge:** As nodes are added or parameters (like `hidden_dim` or `num_heads`) are tweaked via sliders, a live resource panel actively updates: _"Estimated VRAM for Training: 42GB / 80GB (A100)"_.

### 3.3 The Exporter Engine

Converts the visual graph state into executable ML code.

- Reads graph dependencies from Input to Output.
- Smartly groups standard repeated sequences (like a stack of 32 transformer blocks) into `nn.ModuleList`.
- Generates a cleanly formatted `nn.Module` class script that orchestrates the exact `forward()` pass designed in the UI.

## 4. Implementation Phases

**Phase 1: Canvas Prototyping (Frontend Focus)**

- Setup the node-graph library within the `text2llm-web` application.
- Create 5-10 basic LLM node types with custom CSS styling to match the platform's premium UI aesthetics.
- Implement the drag-and-drop mechanics and parameter sliders on the node interfaces.

**Phase 2: The Physics & Validation Engine**

- Implement an event listener on the canvas that triggers whenever an edge is connected or a node parameter changes.
- Write logic to calculate tensor shapes propagating dynamically through the graph.
- Implement memory and compute estimation math (parameters \* bytes + optimizer state + activations).

**Phase 3: Visual Analytics Panel**

- Integrate ECharts in a side-drawer next to the canvas.
- Link the Physics Engine's outputs to live-update the charts (e.g., a pie chart for memory breakdown, a live roofline performance model).

**Phase 4: The Compiler**

- Build the exporter logic (likely via Python on the backend).
- Ingest the JSON graph schema payload from the UI.
- Format a syntactically correct, functioning PyTorch script.
- Add an "Export to Training" button that bridges this payload to the backend execution & training pipeline.

## 5. Next Steps

1. Add `litegraph.js` (or `reactflow` if preferred) as a dependency to the frontend package.
2. Define the JSON schema for the primary architectural nodes.
3. Initialize the `/canvas` routing in the existing application to provide an isolated workspace for development.
