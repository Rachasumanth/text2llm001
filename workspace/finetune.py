import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer, DataCollatorForLanguageModeling
from peft import LoraConfig, get_peft_model, TaskType
from datasets import load_dataset
import os

# 1. Configuration
MODEL_NAME = "Qwen/Qwen2-0.5B"
DATA_FILE = "telugu_english_pairs.jsonl"
OUTPUT_DIR = "./te-en-translator-qwen"

# 2. Load Tokenizer and Model
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    trust_remote_code=True
)

# 3. Configure LoRA
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type=TaskType.CAUSAL_LM
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()

# 4. Load and Process Data
dataset = load_dataset("json", data_files=DATA_FILE, split="train")

def format_instruction(example):
    # User wants Telugu -> English
    # Input: tgt (Telugu), Output: src (English)
    text = f"Telugu: {example['tgt']}\nEnglish: {example['src']}{tokenizer.eos_token}"
    return {"text": text}

dataset = dataset.map(format_instruction)

def tokenize_function(examples):
    return tokenizer(examples["text"], truncation=True, max_length=256, padding="max_length")

tokenized_dataset = dataset.map(tokenize_function, batched=True, remove_columns=dataset.column_names)

# 5. Training Arguments
training_args = TrainingArguments(
    output_dir=OUTPUT_DIR,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    num_train_epochs=1, # 1 epoch for dry run
    logging_steps=5,
    save_steps=50,
    save_total_limit=2,
    bf16=True,
    push_to_hub=False,
    report_to="none"
)

# 6. Initialize Trainer
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized_dataset,
    data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
)

# 7. Start Training
if __name__ == "__main__":
    print("Starting training...")
    trainer.train()
    trainer.save_model(OUTPUT_DIR)
    print(f"Model saved to {OUTPUT_DIR}")
