#!/usr/bin/env python3
import sys
print('---TEXT2LLM_EXECUTION_START---')
print('---CELL_START_cell-1772266723422-9rsv0q---')
try:
    # Ready for GPU inference
    print('Hello from text2llm')
except Exception as e:
    import traceback
    traceback.print_exc()
print('---CELL_END_cell-1772266723422-9rsv0q---')
print('---CELL_START_cell-1772266723422-b4c52h---')
try:
    !pip install transformers torch datasets -q
except Exception as e:
    import traceback
    traceback.print_exc()
print('---CELL_END_cell-1772266723422-b4c52h---')
print('---CELL_START_cell-1772266723433-73ya48---')
try:
    import torch
    from transformers import GPT2LMHeadModel, GPT2Tokenizer
    model = GPT2LMHeadModel.from_pretrained("gpt2")
    tokenizer = GPT2Tokenizer.from_pretrained("gpt2")
    text = "Artificial intelligence is transforming the way we work and live."
    encodings = tokenizer(text, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**encodings, labels=encodings["input_ids"])
        perplexity = torch.exp(outputs.loss).item()
    print(f"Text: {text}")
    print(f"Perplexity: {perplexity:.2f}")
    print("Lower perplexity = better prediction")
except Exception as e:
    import traceback
    traceback.print_exc()
print('---CELL_END_cell-1772266723433-73ya48---')
print('---CELL_START_cell-1772266723430-0gz53e---')
try:
    import torch
    from transformers import GPT2LMHeadModel, GPT2Tokenizer
    model = GPT2LMHeadModel.from_pretrained("gpt2")
    tokenizer = GPT2Tokenizer.from_pretrained("gpt2")
    text = "Artificial intelligence is transforming the way we work and live."
    encodings = tokenizer(text, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**encodings, labels=encodings["input_ids"])
        perplexity = torch.exp(outputs.loss).item()
    print(f"Text: {text}")
    print(f"Perplexity: {perplexity:.2f}")
    print("Lower perplexity = better prediction")
except Exception as e:
    import traceback
    traceback.print_exc()
print('---CELL_END_cell-1772266723430-0gz53e---')
print('---TEXT2LLM_EXECUTION_END---')