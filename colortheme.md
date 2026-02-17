Digital Garden Color Application Guide

Rich Soil #1A1F1C
The foundation where everything grows

Usage Why it works
Main background Dark enough for reduced eye strain during long sessions, warm enough to feel inviting
Terminal/console backgrounds Makes code feel like it's growing from the earth
Modal overlays 80% opacity creates depth without harsh contrast

---

Forest Green #2D6A4F
The living structure

Usage Why it works
Primary buttons (Generate, Run, Create) "Planting" actions feel natural
Active navigation items Shows where you are in the garden
Progress bars Growth metaphor — watching ideas sprout
Border accents on cards/panels Defines spaces without harsh lines
Secondary text (headings, labels) Readable against Rich Soil

---

Sprout Glow #D8F3DC
New life, fresh ideas

Usage Why it works
Input fields (prompt boxes, code editors) Where new ideas are planted
Success states "Your model has grown!"
Generated output backgrounds The fruit of your creativity
Hover states on dark elements Gentle illumination
Syntax highlighting (strings, comments) Soft on the eyes
Empty state illustrations Inviting, not alarming

---

Pollinator Orange #FF9F43
Energy, attention, the spark

Usage Why it works
Primary CTA (Deploy, Share, Export) The "bloom" moment
Notifications Urgent but not alarming
Active indicators (recording, processing) Living, energetic pulse
Badges/achievements Rewards in the garden
Error/warning states Warm attention, not panic red
Creative highlights Emphasize breakthrough moments

---

🎨 example : Specific UI Component Mapping

┌─────────────────────────────────────────────────────────┐
│ [🌿 text2llm.in] Explore Create Settings 👤 │ ← Forest Green nav
├─────────────────────────────────────────────────────────┤
│ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Describe your AI experiment... │ │ ← Sprout Glow input
│ │ [Start with: "A neural network that..."] │ │
│ └─────────────────────────────────────────────────┘ │
│ │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│ │ 🌱 Train │ │ 🧪 Test │ │ 🚀 Deploy │ │ ← Forest Green / Pollinator Orange
│ └─────────────┘ └─────────────┘ └─────────────┘ │
│ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ OUTPUT: │ │
│ │ Your model is growing... [████████░░] 80% │ │ ← Forest Green progress
│ │ │ │
│ │ python │ │
│ │ class NeuralGarden: # Sprout Glow │ │
│ │ def bloom(self): │ │
│ │ return creativity # Pollinator Orange │ │
│ │ │ │
│ └─────────────────────────────────────────────────┘ │
│ │
└─────────────────────────────────────────────────────────┘
↑ Rich Soil background everywhere

---

💡 Pro Tips for Digital Garden

Technique Implementation
Gradients linear-gradient(135deg, #1A1F1C 0%, #2D6A4F 100%) for hero sections
Glow effects box-shadow: 0 0 20px rgba(216, 243, 220, 0.1) on active inputs
Growth animation Progress bars that "grow" like vines using Forest Green
Seasonal variation Slightly shift Sprout Glow from spring green to autumn gold based on user preference

---

Accessibility Notes

- Contrast ratios: All text on Rich Soil passes WCAG AA
- Color blindness: The orange/green differentiation works for most deuteranopia types

---

# Sunlit Garden (Light Mode) ☀️

For users who prefer working in the daylight.

| Role           | Dark Mode (Rich Soil)    | Light Mode (Morning Mist)   | Logic                        |
| -------------- | ------------------------ | --------------------------- | ---------------------------- |
| **Background** | `#1A1F1C` (Rich Soil)    | `#F4F7F5` (Morning Mist)    | Clean, off-white, paper-like |
| **Surface**    | `rgba(45, 106, 79, 0.1)` | `#FFFFFF` (Pure White)      | Distinct cards on soft bg    |
| **Primary**    | `#2D6A4F` (Forest Green) | `#2D6A4F` (Forest Green)    | Identity color remains same  |
| **Text Main**  | `#D8F3DC` (Sprout Glow)  | `#1A1F1C` (Rich Soil)       | Inverted high contrast       |
| **Text Dim**   | `#5d7a6b`                | `#5d7a6b`                   | Mid-tone works on both       |
| **Accent**     | `#FF9F43` (Pollinator)   | `#E88B35` (Deep Pollinator) | Slightly darker for contrast |

**Implementation Strategy:**

- Use `[data-theme="light"]` on `<body>`
- Default to Dark Mode
- Persist in `localStorage`
