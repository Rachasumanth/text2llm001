#!/usr/bin/env python3
"""
Dog-to-Speech Training Data Generator

Generates synthetic labeled training data for a sensor-to-language model.
Maps real veterinary behavioral science (heartbeat ranges, body language signals,
vocalization types) to natural language "translations" of what the dog might be saying.

This is the actual training data format needed - NOT Wikipedia articles.

Output format (each record):
{
  "sensor_input": {
    "heartbeat_bpm": 140,
    "tail_movement": "fast_wag",
    "bark_type": "playful_short",
    "body_posture": "play_bow",
    "ear_position": "forward",
    "breathing_rate": "fast",
    "body_temperature_c": 38.9,
    "muscle_tension": "relaxed",
    "eye_state": "wide_open",
    "vocalization_frequency_hz": 500
  },
  "behavioral_state": "excited_playful",
  "language_output": "I'm so excited! Let's play! Come chase me!",
  "confidence": 0.85,
  "source_context": "Based on veterinary behavioral science"
}
"""

import json
import os
import random
import time

# -----------------------------------------------------------------------
# Veterinary behavioral science data
# Based on published research on canine body language and physiology
# -----------------------------------------------------------------------

# Normal resting heart rate: 60-140 bpm (varies by size)
# Excited: 120-180 bpm
# Stressed/fearful: 150-220 bpm
# Calm/sleepy: 50-80 bpm

BEHAVIORAL_STATES = {
    "excited_playful": {
        "heartbeat_range": (120, 160),
        "tail_options": ["fast_wag", "circular_wag", "full_body_wag"],
        "bark_options": ["playful_short", "rapid_yip", "play_growl"],
        "posture_options": ["play_bow", "bouncing", "spinning"],
        "ear_options": ["forward", "perked_up"],
        "breathing": ["fast", "panting"],
        "temp_range": (38.5, 39.2),
        "muscle": ["relaxed", "energetic"],
        "eyes": ["wide_open", "bright", "soft_squint"],
        "freq_range": (400, 800),
        "phrases": [
            "I'm so excited! Let's play! Come chase me!",
            "Oh wow, this is the best thing ever! Throw the ball!",
            "Play play play! I want to run with you!",
            "You're home! I missed you so much! Let's go outside!",
            "Is that a treat? Is that for me? I love you!",
            "This is amazing! Everything is amazing! You're amazing!",
            "Let me jump on you! I can't contain my happiness!",
            "Run run run! Chase me! I'll chase you back!",
            "I see another dog! Can we go meet them? Please!",
            "Are we going for a walk? The leash! I saw the leash!",
            "YES! The car! Are we going somewhere fun?",
            "Squirrel! Did you see that? Let me at it!",
            "I want to play tug! Give me that rope toy!",
            "Splash splash! I love water! Let me jump in!",
            "You're opening the food bag! Is it dinner time?!",
        ],
    },
    "calm_content": {
        "heartbeat_range": (60, 100),
        "tail_options": ["slow_wag", "gentle_sweep", "relaxed_still"],
        "bark_options": ["none", "soft_sigh", "quiet_grumble"],
        "posture_options": ["lying_relaxed", "sitting_calm", "leaning_on_owner"],
        "ear_options": ["relaxed_neutral", "slightly_back"],
        "breathing": ["slow", "normal"],
        "temp_range": (38.0, 38.6),
        "muscle": ["fully_relaxed", "loose"],
        "eyes": ["half_closed", "soft_gaze", "slow_blink"],
        "freq_range": (0, 200),
        "phrases": [
            "This is nice. I feel safe here with you.",
            "I'm comfortable. Just sitting here is perfect.",
            "Keep petting me right there. That feels good.",
            "Life is good. I have food, warmth, and you.",
            "I'm happy just lying next to you on the couch.",
            "Your hand on my head makes everything okay.",
            "I trust you completely. I can let my guard down.",
            "The sun feels warm on my fur. This is peaceful.",
            "I don't need anything right now. Just your presence.",
            "You smell familiar and safe. I belong here.",
            "Resting my head on your lap. This is my favorite.",
            "Everything is quiet. Everything is calm. I like this.",
            "I can hear your heartbeat. It makes me feel secure.",
            "No threats, no worries. Just us.",
            "I could stay like this forever.",
        ],
    },
    "fearful_anxious": {
        "heartbeat_range": (150, 220),
        "tail_options": ["tucked_low", "between_legs", "stiff_low"],
        "bark_options": ["high_whine", "whimper", "yelp", "none_frozen"],
        "posture_options": ["crouching", "cowering", "hiding", "trembling"],
        "ear_options": ["flat_back", "pinned"],
        "breathing": ["rapid_shallow", "panting_stressed"],
        "temp_range": (38.8, 39.5),
        "muscle": ["tense", "rigid", "trembling"],
        "eyes": ["whale_eye", "dilated_pupils", "avoiding_gaze"],
        "freq_range": (800, 2000),
        "phrases": [
            "Something is wrong. I'm scared. Where are you?",
            "That loud noise! Make it stop! I need to hide!",
            "I don't like this place. Can we leave? Please?",
            "The thunder... it's coming again. Hold me.",
            "That person is too close. I don't trust them.",
            "I smell something strange and dangerous.",
            "My body is shaking. I can't help it. I'm afraid.",
            "Don't leave me alone! I need you here!",
            "The fireworks are hurting my ears. Make them stop.",
            "I'm trying to make myself small. Don't notice me.",
            "The vet smell... I remember this place. No no no.",
            "That dog is bigger than me. I don't want to fight.",
            "The storm is coming. I can feel it. I need my safe spot.",
            "Everyone is yelling. The energy feels bad. I'm worried.",
            "I hear something outside. I don't know what. I'm alert.",
        ],
    },
    "hungry_wanting": {
        "heartbeat_range": (90, 130),
        "tail_options": ["slow_wag", "expectant_wag", "perked_stiff"],
        "bark_options": ["demand_bark", "whine_request", "soft_huff"],
        "posture_options": ["sitting_staring", "pawing", "near_food_bowl", "nudging"],
        "ear_options": ["forward", "alert"],
        "breathing": ["normal", "slightly_fast"],
        "temp_range": (38.3, 38.8),
        "muscle": ["alert", "tense_anticipation"],
        "eyes": ["intense_stare", "tracking_food", "puppy_eyes"],
        "freq_range": (300, 600),
        "phrases": [
            "I'm hungry. My bowl has been empty for ages.",
            "You're eating something. Can I have some? Please?",
            "I know where the treats are. Top shelf. I can smell them.",
            "It's past my dinner time. Did you forget about me?",
            "That smells incredible. Whatever you're cooking, I want it.",
            "I'll sit perfectly. I'll do any trick. Just give me food.",
            "Water. I need water. My bowl is dry.",
            "I'm doing my cutest face. Is it working? Give me a bite.",
            "I've been staring at you for ten minutes. Feed me.",
            "The fridge opened! Something good is in there, I know it.",
            "I'll follow you to the kitchen. Just in case you need help.",
            "My stomach just growled. Even I heard it.",
            "That other dog got a treat and I didn't. Not fair.",
            "I'll trade you this sock for a biscuit. Deal?",
            "I can sit. I can shake. I can roll over. NOW give me food.",
        ],
    },
    "protective_alert": {
        "heartbeat_range": (130, 180),
        "tail_options": ["stiff_raised", "bristled_high", "rigid_still"],
        "bark_options": ["deep_warning", "rapid_alarm", "sustained_bark", "growl"],
        "posture_options": ["standing_tall", "hackles_raised", "blocking_path", "lunging"],
        "ear_options": ["forward_rigid", "rotating_scanning"],
        "breathing": ["fast", "through_nose"],
        "temp_range": (38.6, 39.3),
        "muscle": ["very_tense", "coiled", "ready_to_spring"],
        "eyes": ["hard_stare", "fixed_gaze", "no_blinking"],
        "freq_range": (200, 500),
        "phrases": [
            "Someone is at the door! I hear footsteps! ALERT!",
            "Stay behind me. I will protect this family.",
            "That person shouldn't be here. I don't recognize their smell.",
            "I hear something outside. Nobody moves until I check.",
            "My territory. You are not welcome. Leave now.",
            "The mail carrier again! Every day they come to MY house!",
            "I sense danger. The air smells wrong.",
            "Don't touch my human. I'm watching you.",
            "Something is moving in the bushes. I need to investigate.",
            "A strange car parked outside. I'm keeping watch.",
            "I bark so you know I'm here. I'm big. I'm scary. Go away.",
            "The baby is sleeping. Nobody disturb the baby.",
            "My pack is safe as long as I'm awake. I won't sleep.",
            "You, stranger. I see you. Do not come closer.",
            "The window! Something moved past the window!",
        ],
    },
    "sad_lonely": {
        "heartbeat_range": (70, 100),
        "tail_options": ["hanging_low", "slow_occasional_wag", "still_down"],
        "bark_options": ["long_howl", "soft_whimper", "mournful_cry", "none_withdrawn"],
        "posture_options": ["lying_head_on_paws", "facing_door", "curled_tight", "by_owners_shoes"],
        "ear_options": ["drooped_back", "flat_sad"],
        "breathing": ["slow_deep", "occasional_sigh"],
        "temp_range": (37.8, 38.4),
        "muscle": ["limp", "no_energy"],
        "eyes": ["looking_up_sad", "watching_door", "glassy"],
        "freq_range": (100, 400),
        "phrases": [
            "You left and I don't know if you're coming back.",
            "The house is empty. It's too quiet without you.",
            "I keep sniffing your pillow. It still smells like you.",
            "I don't want to eat. Not without you here.",
            "I sat by the door all day. You never came.",
            "My friend from the park is gone. I miss playing with them.",
            "The other dog moved away. I keep looking for them.",
            "I hear your car but it drives past. It wasn't you.",
            "I brought you my toy but there's nobody to throw it.",
            "Everything reminds me of you. Your shoes. Your chair.",
            "I howl so maybe you'll hear me and come home.",
            "It's raining outside and I'm alone inside. So quiet.",
            "I don't understand where everyone went.",
            "I wait here every day at this time. You used to come home now.",
            "Please come back. I promise I'll be good.",
        ],
    },
    "pain_discomfort": {
        "heartbeat_range": (100, 170),
        "tail_options": ["tucked", "stiff", "still_low"],
        "bark_options": ["sharp_yelp", "continuous_whine", "growl_when_touched", "none_stoic"],
        "posture_options": ["limping", "guarding_area", "hunched", "refusing_to_move"],
        "ear_options": ["back", "flat"],
        "breathing": ["panting", "rapid_shallow", "irregular"],
        "temp_range": (39.0, 40.5),
        "muscle": ["guarding", "flinching", "rigid_area"],
        "eyes": ["squinting", "glazed", "unfocused"],
        "freq_range": (600, 1500),
        "phrases": [
            "It hurts. My leg hurts when I walk.",
            "Don't touch that spot. Please. It's sore.",
            "I feel sick. My stomach doesn't feel right.",
            "I can't get comfortable. Everything aches.",
            "Something is wrong inside me. I don't know what.",
            "My ear is burning. I keep scratching but it won't stop.",
            "I can't eat today. It hurts to chew.",
            "I need to lie down. I don't have energy to play.",
            "My paw stings. I keep licking it but it doesn't help.",
            "I'm panting but I'm not hot. Something feels wrong.",
            "Carry me. I don't want to use the stairs.",
            "I yelped because you surprised the hurt spot.",
            "I need help. I can't tell you where it hurts.",
            "The itching won't stop. My whole body is on fire.",
            "I just want to sleep until this goes away.",
        ],
    },
    "curious_investigating": {
        "heartbeat_range": (100, 140),
        "tail_options": ["horizontal_wagging", "stiff_horizontal", "twitching_tip"],
        "bark_options": ["none_focused", "alert_woof", "questioning_arf"],
        "posture_options": ["sniffing_ground", "head_tilt", "approaching_slowly", "one_paw_raised"],
        "ear_options": ["forward_perked", "rotating", "one_forward_one_back"],
        "breathing": ["sniffing_rapid", "through_nose"],
        "temp_range": (38.3, 38.9),
        "muscle": ["poised", "ready", "light_tension"],
        "eyes": ["focused", "tracking", "wide_alert"],
        "freq_range": (200, 500),
        "phrases": [
            "What is that smell? I've never smelled this before.",
            "Something is different about this room. What changed?",
            "That sound... where is it coming from?",
            "New person! Let me sniff you. I need to catalog your scent.",
            "There's a bug on the floor. It's moving. Fascinating.",
            "What are you building? Can I help? Can I sniff it?",
            "That box wasn't here yesterday. What's inside?",
            "The grass smells different today. Another animal was here.",
            "I tilt my head because I'm trying to understand you.",
            "You made a new sound. What does it mean?",
            "Something is under the couch. I can hear it breathing.",
            "The mirror dog is back. Who is that handsome boy?",
            "You brought a bag home. It has interesting smells. Show me.",
            "A new route! I don't know this path. Everything to sniff!",
            "What is the cat doing up there? I want to know.",
        ],
    },
}

# -----------------------------------------------------------------------
# Data generation
# -----------------------------------------------------------------------

def generate_record(state_name, state_data, record_id):
    """Generate one training record with sensor inputs and language output."""
    hr = random.randint(*state_data["heartbeat_range"])
    temp = round(random.uniform(*state_data["temp_range"]), 1)
    freq = random.randint(*state_data["freq_range"])

    sensor_input = {
        "heartbeat_bpm": hr,
        "tail_movement": random.choice(state_data["tail_options"]),
        "bark_type": random.choice(state_data["bark_options"]),
        "body_posture": random.choice(state_data["posture_options"]),
        "ear_position": random.choice(state_data["ear_options"]),
        "breathing_rate": random.choice(state_data["breathing"]),
        "body_temperature_c": temp,
        "muscle_tension": random.choice(state_data["muscle"]),
        "eye_state": random.choice(state_data["eyes"]),
        "vocalization_frequency_hz": freq,
    }

    phrase = random.choice(state_data["phrases"])
    # Add slight variation
    variations = [
        phrase,
        phrase.rstrip("!.") + ".",
        phrase.rstrip("!.") + "!",
    ]

    return {
        "id": f"dog-speak-{record_id:05d}",
        "sensor_input": sensor_input,
        "behavioral_state": state_name,
        "language_output": random.choice(variations),
        "confidence": round(random.uniform(0.70, 0.95), 2),
        "source_context": "Synthetic training data based on veterinary behavioral science",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def main():
    output_dir = r"c:\Users\4HIN\source\openclaw\workspace\skills\data-pipeline\output\dog-speak"
    os.makedirs(output_dir, exist_ok=True)

    all_records = []
    record_id = 0

    # Generate balanced dataset: ~50 records per behavioral state
    records_per_state = 50

    for state_name, state_data in BEHAVIORAL_STATES.items():
        print(f"Generating {records_per_state} records for state: {state_name}")
        for _ in range(records_per_state):
            record = generate_record(state_name, state_data, record_id)
            all_records.append(record)
            record_id += 1

    # Shuffle for training
    random.shuffle(all_records)

    # Write JSONL
    output_path = os.path.join(output_dir, "dog_speak_training.jsonl")
    with open(output_path, "w", encoding="utf-8") as fh:
        for record in all_records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"\n{'='*60}")
    print(f"GENERATED TRAINING DATASET")
    print(f"{'='*60}")
    print(f"Total records: {len(all_records)}")
    print(f"Behavioral states: {len(BEHAVIORAL_STATES)}")
    print(f"Records per state: {records_per_state}")
    print(f"Output: {output_path}")
    print(f"Size: {os.path.getsize(output_path) // 1024} KB")

    print(f"\n--- Sample Records ---")
    for i in range(5):
        r = all_records[i]
        print(f"\n[{r['behavioral_state'].upper()}]")
        s = r["sensor_input"]
        print(f"  Heart: {s['heartbeat_bpm']}bpm | Tail: {s['tail_movement']} | Bark: {s['bark_type']}")
        print(f"  Posture: {s['body_posture']} | Ears: {s['ear_position']} | Temp: {s['body_temperature_c']}C")
        print(f"  → \"{r['language_output']}\"")


if __name__ == "__main__":
    main()
