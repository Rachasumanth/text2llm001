#!/usr/bin/env python3
"""
Dataset Creator – Production-Grade Synthetic Training Data Generator
Generates high-volume, high-quality sensor→language training data.

Improvements over v1:
  1. Phrase augmentation: Template-based expansion → 1000s of unique outputs per state
  2. Correlated sensors: Realistic multi-sensor correlation (not independent random)
  3. Transition states: Mixed emotional states with blended sensor readings
  4. Noise injection: Gaussian noise on numeric sensors for robustness
  5. Quality scoring: Filters low-quality / ambiguous records
  6. Train/val/test splits: 80/10/10 with stratified sampling
  7. Dataset card: Auto-generated metadata manifest
  8. Scale: Supports 10k–1M+ records efficiently

Usage:
  python generate_training_data.py --domain "animal-sensor" \
    --task "dog sensors to speech" --count 200 \
    --sensors "heartbeat,tail,bark,posture,ears" \
    --output-format jsonl
"""

import argparse
import json
import os
import sys
import time
import random
import hashlib
import math
from pathlib import Path
from collections import Counter

def log(msg):
    print(f"[synth-gen] {msg}", flush=True)

# -----------------------------------------------------------------------
# Phrase Augmentation Engine
# Turns 15 base phrases into 100s of unique variants per state
# -----------------------------------------------------------------------

# Emotion intensifiers / softeners
INTENSIFIERS = ["", "really ", "so ", "incredibly ", "absolutely "]
SOFTENERS = ["", "kind of ", "a little ", "somewhat ", "slightly "]
FILLERS = ["", "I think ", "I feel like ", "honestly, ", "right now, "]

# Sentence-ending variation
ENDINGS_EXCITED = ["!", "!!", "! Yes!", "! Please!", "! Come on!"]
ENDINGS_CALM = [".", "...", ". That's nice.", ". Mmm."]
ENDINGS_FEAR = ["!", "...", "! Help!", "! Please!"]
ENDINGS_NEUTRAL = [".", "!", "..."]

def augment_phrase(phrase, state_name, attempt=0):
    """Generate a unique variation of a base phrase."""
    random.seed(hash(phrase) + attempt + random.randint(0, 999999))

    # 1. Apply filler prefix
    filler = random.choice(FILLERS)

    # 2. Apply intensifier/softener based on state
    if state_name in ("excited_playful", "protective_alert"):
        modifier = random.choice(INTENSIFIERS)
    elif state_name in ("fearful_anxious", "pain_discomfort"):
        modifier = random.choice(INTENSIFIERS[:3] + SOFTENERS[:2])
    elif state_name in ("calm_content", "sad_lonely"):
        modifier = random.choice(SOFTENERS)
    else:
        modifier = random.choice(["", "", ""])

    # 3. Light word substitutions
    substitutions = {
        "scared": random.choice(["scared", "frightened", "terrified", "nervous", "anxious"]),
        "happy": random.choice(["happy", "joyful", "thrilled", "delighted", "overjoyed"]),
        "hurts": random.choice(["hurts", "aches", "stings", "throbs", "burns"]),
        "hungry": random.choice(["hungry", "starving", "famished", "ravenous"]),
        "safe": random.choice(["safe", "secure", "protected", "comfortable"]),
        "play": random.choice(["play", "run around", "have fun", "mess around", "go wild"]),
        "smell": random.choice(["smell", "scent", "odor", "whiff"]),
        "hear": random.choice(["hear", "detect", "notice", "pick up on"]),
        "love": random.choice(["love", "adore", "cherish", "really like"]),
        "food": random.choice(["food", "dinner", "meal", "treats", "kibble", "snacks"]),
    }

    augmented = phrase
    for original, replacement in substitutions.items():
        if original in augmented.lower() and random.random() > 0.5:
            augmented = augmented.replace(original, replacement, 1)
            augmented = augmented.replace(original.capitalize(), replacement.capitalize(), 1)

    # 4. Apply filler + modifier to some sentences
    if random.random() > 0.6 and filler:
        sentences = augmented.split(". ")
        if len(sentences) > 1:
            idx = random.randint(0, len(sentences) - 1)
            sentences[idx] = filler + sentences[idx][0].lower() + sentences[idx][1:]
            augmented = ". ".join(sentences)

    # 5. Vary ending punctuation
    if state_name == "excited_playful":
        endings = ENDINGS_EXCITED
    elif state_name in ("calm_content", "sad_lonely"):
        endings = ENDINGS_CALM
    elif state_name in ("fearful_anxious", "pain_discomfort"):
        endings = ENDINGS_FEAR
    else:
        endings = ENDINGS_NEUTRAL

    if random.random() > 0.5:
        augmented = augmented.rstrip("!.?,; ") + random.choice(endings)

    # 6. Occasionally add a second thought
    second_thoughts = {
        "excited_playful": ["I can barely sit still!", "My tail won't stop!", "Best day ever!"],
        "calm_content": ["*sighs contentedly*", "Just perfect.", "I could nap right here."],
        "fearful_anxious": ["My heart is racing.", "I need my safe spot.", "Where's my human?"],
        "hungry_wanting": ["*licks lips*", "My stomach is growling.", "I've been so patient."],
        "protective_alert": ["I won't back down.", "This is my territory.", "I'm on full alert."],
        "sad_lonely": ["*whimpers softly*", "The silence is heavy.", "I miss the old days."],
        "pain_discomfort": ["*winces*", "I'm trying to be brave.", "Please be gentle."],
        "curious_investigating": ["Must investigate!", "So many new things!", "What could it be?"],
    }
    if random.random() > 0.7 and state_name in second_thoughts:
        augmented += " " + random.choice(second_thoughts[state_name])

    return augmented


# -----------------------------------------------------------------------
# Correlated Sensor Generator
# Real sensors are correlated — fast heartbeat + tense muscles + rapid breathing
# -----------------------------------------------------------------------

def generate_correlated_sensors(state_data, noise_std=0.1):
    """Generate sensors with realistic correlations and Gaussian noise."""
    sensors = {}
    
    # Pick a "base intensity" for this record (0.0–1.0)
    # This drives all the sensors together, creating correlation
    intensity = random.betavariate(2, 2)  # Bell-curve around 0.5

    for sensor_name, sensor_spec in state_data["sensors"].items():
        if isinstance(sensor_spec, tuple) and len(sensor_spec) == 2:
            low, high = sensor_spec
            # Use intensity to pick a value within range, then add noise
            base = low + (high - low) * intensity
            noise = random.gauss(0, (high - low) * noise_std)
            value = base + noise
            
            if isinstance(low, int):
                sensors[sensor_name] = max(low, min(high, int(round(value))))
            else:
                sensors[sensor_name] = round(max(low, min(high, value)), 1)
        elif isinstance(sensor_spec, list):
            # Categorical sensors: higher intensity → later items in list
            idx = min(int(intensity * len(sensor_spec)), len(sensor_spec) - 1)
            # Add some randomness
            idx = max(0, min(len(sensor_spec) - 1, idx + random.randint(-1, 1)))
            sensors[sensor_name] = sensor_spec[idx]

    return sensors


# -----------------------------------------------------------------------
# Transition State Generator
# Real emotions blend — a dog can be both excited AND slightly anxious
# -----------------------------------------------------------------------

def generate_transition_record(states_data, record_id, user_sensors=None):
    """Generate a blended record mixing two states."""
    state_names = list(states_data.keys())
    primary = random.choice(state_names)
    secondary = random.choice([s for s in state_names if s != primary])
    
    # Primary dominates (60-80% weight)
    primary_weight = random.uniform(0.6, 0.8)
    
    primary_sensors = generate_correlated_sensors(states_data[primary])
    secondary_sensors = generate_correlated_sensors(states_data[secondary])
    
    # Blend numeric sensors
    blended = {}
    for key in primary_sensors:
        if user_sensors and not any(s in key.lower() for s in user_sensors):
            continue
        pv = primary_sensors.get(key)
        sv = secondary_sensors.get(key)
        if isinstance(pv, (int, float)) and isinstance(sv, (int, float)):
            val = pv * primary_weight + sv * (1 - primary_weight)
            blended[key] = int(round(val)) if isinstance(pv, int) else round(val, 1)
        else:
            blended[key] = pv if random.random() < primary_weight else sv

    # Generate a transition phrase
    primary_phrase = random.choice(states_data[primary]["outputs"])
    secondary_phrase = random.choice(states_data[secondary]["outputs"])
    
    connectors = [
        "but also, ",
        "and at the same time, ",
        "although part of me thinks ",
        "yet I also feel like ",
        "mixed with the feeling that ",
    ]
    
    # Augment the primary phrase
    aug_primary = augment_phrase(primary_phrase, primary)
    
    # Sometimes append a blended secondary thought
    if random.random() > 0.5:
        language = aug_primary + " " + random.choice(connectors) + secondary_phrase.lower()
    else:
        language = aug_primary

    return {
        "sensor_input": blended,
        "behavioral_state": f"{primary}+{secondary}",
        "primary_state": primary,
        "secondary_state": secondary,
        "blend_ratio": round(primary_weight, 2),
        "language_output": language,
        "confidence": round(random.uniform(0.55, 0.80), 2),  # Lower confidence for blended
        "record_type": "transition",
    }


# -----------------------------------------------------------------------
# Quality Scorer
# Filters out ambiguous, too-short, or low-information records
# -----------------------------------------------------------------------

def score_quality(record):
    """Score a record's quality 0.0–1.0."""
    score = 1.0
    text = record.get("language_output", "")
    
    # Penalize very short outputs
    if len(text) < 20:
        score -= 0.3
    elif len(text) < 40:
        score -= 0.1
    
    # Penalize very long outputs (rambling)
    if len(text) > 300:
        score -= 0.2
    
    # Penalize low word diversity
    words = text.lower().split()
    if len(words) > 5:
        unique_ratio = len(set(words)) / len(words)
        if unique_ratio < 0.4:
            score -= 0.3
    
    # Bonus for natural sentence structure
    if text[0].isupper() and text[-1] in ".!?":
        score += 0.1
    
    # Penalize if sensor_input is too sparse
    sensors = record.get("sensor_input", {})
    if len(sensors) < 3:
        score -= 0.2
    
    return max(0.0, min(1.0, score))


# -----------------------------------------------------------------------
# Domain Templates
# -----------------------------------------------------------------------

DOMAINS = {
    "animal-sensor": {
        "states": {
            "excited_playful": {
                "sensors": {
                    "heartbeat_bpm": (120, 160),
                    "tail_movement": ["fast_wag", "circular_wag", "full_body_wag", "helicopter_spin"],
                    "bark_type": ["playful_short", "rapid_yip", "play_growl", "excited_howl"],
                    "body_posture": ["play_bow", "bouncing", "spinning", "zoomies", "jumping"],
                    "ear_position": ["forward", "perked_up", "alert_forward"],
                    "breathing_rate": ["fast", "panting", "rapid_panting"],
                    "body_temperature_c": (38.5, 39.2),
                    "muscle_tension": ["relaxed", "energetic", "spring_loaded"],
                    "eye_state": ["wide_open", "bright", "soft_squint", "sparkly"],
                    "vocalization_frequency_hz": (400, 800),
                    "cortisol_level": (0.1, 0.3),
                    "serotonin_level": (0.7, 0.95),
                },
                "outputs": [
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
                    "There's a ball! BALL! Can you throw it? BALL!",
                    "My whole body is wiggling because I'm so happy!",
                    "The door opened! What's out there? Let me see!",
                    "I'm doing zoomies because I can't contain the joy!",
                    "Pet me! Scratch me! I'll roll over for belly rubs!",
                ],
            },
            "calm_content": {
                "sensors": {
                    "heartbeat_bpm": (55, 100),
                    "tail_movement": ["slow_wag", "gentle_sweep", "relaxed_still", "lazy_thump"],
                    "bark_type": ["none", "soft_sigh", "quiet_grumble", "contented_moan"],
                    "body_posture": ["lying_relaxed", "sitting_calm", "leaning_on_owner", "sprawled_out", "chin_on_paws"],
                    "ear_position": ["relaxed_neutral", "slightly_back", "soft_floppy"],
                    "breathing_rate": ["slow", "normal", "deep_rhythmic"],
                    "body_temperature_c": (37.8, 38.6),
                    "muscle_tension": ["fully_relaxed", "loose", "melted"],
                    "eye_state": ["half_closed", "soft_gaze", "slow_blink", "sleepy_droop"],
                    "vocalization_frequency_hz": (0, 200),
                    "cortisol_level": (0.05, 0.15),
                    "serotonin_level": (0.6, 0.85),
                },
                "outputs": [
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
                    "The blanket is warm and soft. I'm sinking into it.",
                    "Your voice is gentle. It soothes me.",
                    "I'm drifting off to sleep. Everything feels right.",
                    "The house is warm and quiet. My favorite kind of evening.",
                    "I feel loved. That's the best thing in the world.",
                ],
            },
            "fearful_anxious": {
                "sensors": {
                    "heartbeat_bpm": (150, 220),
                    "tail_movement": ["tucked_low", "between_legs", "stiff_low", "pressed_to_belly"],
                    "bark_type": ["high_whine", "whimper", "yelp", "none_frozen", "chattering_teeth"],
                    "body_posture": ["crouching", "cowering", "hiding", "trembling", "belly_to_ground", "pressed_against_wall"],
                    "ear_position": ["flat_back", "pinned", "completely_flat"],
                    "breathing_rate": ["rapid_shallow", "panting_stressed", "hyperventilating"],
                    "body_temperature_c": (38.8, 39.5),
                    "muscle_tension": ["tense", "rigid", "trembling", "locked_up"],
                    "eye_state": ["whale_eye", "dilated_pupils", "avoiding_gaze", "darting"],
                    "vocalization_frequency_hz": (800, 2000),
                    "cortisol_level": (0.6, 0.95),
                    "serotonin_level": (0.1, 0.3),
                },
                "outputs": [
                    "Something is wrong. I'm scared. Where are you?",
                    "That loud noise! Make it stop! I need to hide!",
                    "I don't like this place. Can we leave? Please?",
                    "The thunder is coming again. Hold me.",
                    "That person is too close. I don't trust them.",
                    "I smell something strange and dangerous.",
                    "My body is shaking. I can't help it. I'm afraid.",
                    "Don't leave me alone! I need you here!",
                    "The fireworks are hurting my ears. Make them stop.",
                    "I'm trying to make myself small. Don't notice me.",
                    "The vet smell. I remember this place. No no no.",
                    "That dog is bigger than me. I don't want to fight.",
                    "The storm is coming. I can feel it. I need my safe spot.",
                    "Everyone is yelling. The energy feels bad. I'm worried.",
                    "I hear something outside. I don't know what. I'm alert.",
                    "The floor is shaking. What is happening? Is it safe?",
                    "Too many strangers. Too many sounds. I'm overwhelmed.",
                    "I can feel the tension in the room. Something bad is about to happen.",
                    "My paws are sweating. That only happens when I'm really nervous.",
                    "I want to be invisible right now. Just let me disappear.",
                ],
            },
            "hungry_wanting": {
                "sensors": {
                    "heartbeat_bpm": (85, 130),
                    "tail_movement": ["slow_wag", "expectant_wag", "perked_stiff", "hopeful_sweep"],
                    "bark_type": ["demand_bark", "whine_request", "soft_huff", "impatient_grumble"],
                    "body_posture": ["sitting_staring", "pawing", "near_food_bowl", "nudging", "following_human"],
                    "ear_position": ["forward", "alert", "one_perked"],
                    "breathing_rate": ["normal", "slightly_fast", "sniffing"],
                    "body_temperature_c": (38.3, 38.8),
                    "muscle_tension": ["alert", "tense_anticipation", "restless"],
                    "eye_state": ["intense_stare", "tracking_food", "puppy_eyes", "begging_gaze"],
                    "vocalization_frequency_hz": (300, 600),
                    "cortisol_level": (0.2, 0.45),
                    "serotonin_level": (0.3, 0.5),
                },
                "outputs": [
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
                    "I'll follow you to the kitchen. Just in case.",
                    "My stomach just growled. Even I heard it.",
                    "That other dog got a treat and I didn't. Not fair.",
                    "I'll trade you this sock for a biscuit. Deal?",
                    "I can sit. I can shake. I can roll over. NOW give me food.",
                    "The crinkle of that wrapper. I know that sound. Is it for me?",
                    "I dropped my toy at your feet. Now you owe me a treat.",
                    "I'm not begging. I'm just... supervising your meal.",
                    "You opened the cabinet! The treat cabinet! I heard it!",
                    "Everyone else has eaten. When is it my turn?",
                ],
            },
            "protective_alert": {
                "sensors": {
                    "heartbeat_bpm": (130, 185),
                    "tail_movement": ["stiff_raised", "bristled_high", "rigid_still", "flagging"],
                    "bark_type": ["deep_warning", "rapid_alarm", "sustained_bark", "growl", "snarl"],
                    "body_posture": ["standing_tall", "hackles_raised", "blocking_path", "lunging", "chest_forward"],
                    "ear_position": ["forward_rigid", "rotating_scanning", "pinned_forward"],
                    "breathing_rate": ["fast", "through_nose", "huffing"],
                    "body_temperature_c": (38.6, 39.3),
                    "muscle_tension": ["very_tense", "coiled", "ready_to_spring", "locked"],
                    "eye_state": ["hard_stare", "fixed_gaze", "no_blinking", "narrowed"],
                    "vocalization_frequency_hz": (150, 500),
                    "cortisol_level": (0.5, 0.8),
                    "serotonin_level": (0.2, 0.45),
                },
                "outputs": [
                    "Someone is at the door! I hear footsteps! ALERT!",
                    "Stay behind me. I will protect this family.",
                    "That person shouldn't be here. I don't recognize their smell.",
                    "I hear something outside. Nobody moves until I check.",
                    "My territory. You are not welcome. Leave now.",
                    "The mail carrier again. Every day they challenge me.",
                    "I sense danger. The air smells wrong.",
                    "Don't touch my human. I'm watching you.",
                    "Something is moving in the bushes. I need to investigate.",
                    "A strange car parked outside. I'm keeping watch.",
                    "I bark so you know I'm here. I'm big. I'm brave. Go away.",
                    "The baby is sleeping. Nobody disturb the baby.",
                    "My pack is safe as long as I'm awake. I won't sleep.",
                    "You, stranger. I see you. Do not come closer.",
                    "The window! Something moved past the window!",
                    "I will stand between you and whatever that is.",
                    "The other animal is in OUR yard. This cannot stand.",
                    "Every hair on my back is standing up. I'm ready.",
                    "I've positioned myself at the door. Nothing gets past me.",
                    "That noise downstairs. I heard it first. I'll go check.",
                ],
            },
            "sad_lonely": {
                "sensors": {
                    "heartbeat_bpm": (60, 100),
                    "tail_movement": ["hanging_low", "slow_occasional_wag", "still_down", "limp"],
                    "bark_type": ["long_howl", "soft_whimper", "mournful_cry", "none_withdrawn", "quiet_moan"],
                    "body_posture": ["lying_head_on_paws", "facing_door", "curled_tight", "by_owners_shoes", "under_furniture"],
                    "ear_position": ["drooped_back", "flat_sad", "heavy"],
                    "breathing_rate": ["slow_deep", "occasional_sigh", "labored_sighs"],
                    "body_temperature_c": (37.5, 38.4),
                    "muscle_tension": ["limp", "no_energy", "heavy"],
                    "eye_state": ["looking_up_sad", "watching_door", "glassy", "unfocused"],
                    "vocalization_frequency_hz": (80, 400),
                    "cortisol_level": (0.4, 0.7),
                    "serotonin_level": (0.1, 0.25),
                },
                "outputs": [
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
                    "The couch feels too big when I'm here alone.",
                    "I circled three times but couldn't get comfortable. Not without you.",
                    "My tail hasn't wagged since you left.",
                    "I found your sock and I'm holding it. It helps a little.",
                    "The light is fading and you're still not home.",
                ],
            },
            "pain_discomfort": {
                "sensors": {
                    "heartbeat_bpm": (100, 175),
                    "tail_movement": ["tucked", "stiff", "still_low", "twitching"],
                    "bark_type": ["sharp_yelp", "continuous_whine", "growl_when_touched", "none_stoic", "grinding"],
                    "body_posture": ["limping", "guarding_area", "hunched", "refusing_to_move", "licking_wound"],
                    "ear_position": ["back", "flat", "pressed"],
                    "breathing_rate": ["panting", "rapid_shallow", "irregular", "holding_breath"],
                    "body_temperature_c": (39.0, 40.8),
                    "muscle_tension": ["guarding", "flinching", "rigid_area", "spasm"],
                    "eye_state": ["squinting", "glazed", "unfocused", "wincing"],
                    "vocalization_frequency_hz": (500, 1500),
                    "cortisol_level": (0.6, 0.95),
                    "serotonin_level": (0.05, 0.2),
                },
                "outputs": [
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
                    "Every step sends a sharp pain through my body.",
                    "I'm shivering but I'm not cold. Something is off.",
                    "I keep looking at the sore spot. Please notice.",
                    "I growled. I'm sorry. It just really hurts there.",
                    "My breathing is different. I can feel it. Something is wrong.",
                ],
            },
            "curious_investigating": {
                "sensors": {
                    "heartbeat_bpm": (95, 145),
                    "tail_movement": ["horizontal_wagging", "stiff_horizontal", "twitching_tip", "slow_upward"],
                    "bark_type": ["none_focused", "alert_woof", "questioning_arf", "soft_chuff"],
                    "body_posture": ["sniffing_ground", "head_tilt", "approaching_slowly", "one_paw_raised", "nose_forward"],
                    "ear_position": ["forward_perked", "rotating", "one_forward_one_back", "satellite_mode"],
                    "breathing_rate": ["sniffing_rapid", "through_nose", "deep_inhale"],
                    "body_temperature_c": (38.3, 38.9),
                    "muscle_tension": ["poised", "ready", "light_tension", "alert_stillness"],
                    "eye_state": ["focused", "tracking", "wide_alert", "head_cocked"],
                    "vocalization_frequency_hz": (200, 500),
                    "cortisol_level": (0.15, 0.35),
                    "serotonin_level": (0.5, 0.7),
                },
                "outputs": [
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
                    "There's a new texture on the floor. I must investigate with my paws.",
                    "That bird is doing something unusual. I'm tracking it.",
                    "The air pressure changed. I can feel it in my whiskers.",
                    "You're using a new tool. The sound is unfamiliar but intriguing.",
                    "There's a whole story written in the smells on this fire hydrant.",
                ],
            },
        },
    },
}


# -----------------------------------------------------------------------
# Main Generation
# -----------------------------------------------------------------------

def write_jsonl(records, output_path):
    with open(output_path, "w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    log(f"Wrote {len(records)} records to {output_path}")


def generate_dataset(domain_key, count_per_state, user_sensors=None, min_quality=0.5):
    domain_data = DOMAINS.get(domain_key, DOMAINS["animal-sensor"])
    states = domain_data["states"]
    
    all_records = []
    stats = {"generated": 0, "filtered": 0, "transitions": 0}
    record_id = 0
    seen_hashes = set()

    for state_name, state_data in states.items():
        log(f"Generating {count_per_state} records for: {state_name}")
        generated = 0
        attempts = 0
        
        while generated < count_per_state and attempts < count_per_state * 3:
            attempts += 1
            
            # Generate correlated sensors
            sensors = generate_correlated_sensors(state_data)
            
            # Filter to user-specified sensors if provided
            if user_sensors:
                sensors = {k: v for k, v in sensors.items() if any(s in k.lower() for s in user_sensors)}
            
            # Pick and augment a phrase
            base_phrase = random.choice(state_data["outputs"])
            augmented = augment_phrase(base_phrase, state_name, attempt=attempts)
            
            # Dedup check
            text_hash = hashlib.sha256(augmented.encode()).hexdigest()[:16]
            if text_hash in seen_hashes:
                continue
            seen_hashes.add(text_hash)
            
            record = {
                "id": f"synth-{record_id:06d}",
                "sensor_input": sensors,
                "behavioral_state": state_name,
                "language_output": augmented,
                "confidence": round(random.uniform(0.75, 0.95), 2),
                "record_type": "primary",
                "source": "synthetic",
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            
            # Quality check
            quality = score_quality(record)
            record["quality_score"] = round(quality, 2)
            
            if quality >= min_quality:
                all_records.append(record)
                generated += 1
                record_id += 1
                stats["generated"] += 1
            else:
                stats["filtered"] += 1

    # Generate transition states (~15% of total)
    transition_count = max(1, int(len(all_records) * 0.15))
    log(f"Generating {transition_count} transition (blended) records...")
    for _ in range(transition_count):
        record = generate_transition_record(states, record_id, user_sensors)
        record["id"] = f"synth-{record_id:06d}"
        record["source"] = "synthetic"
        record["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        
        quality = score_quality(record)
        record["quality_score"] = round(quality, 2)
        
        if quality >= min_quality:
            all_records.append(record)
            record_id += 1
            stats["transitions"] += 1

    random.shuffle(all_records)
    return all_records, stats


def split_dataset(records, train=0.8, val=0.1, test=0.1):
    """Stratified split by behavioral_state."""
    by_state = {}
    for r in records:
        state = r.get("primary_state", r.get("behavioral_state", "unknown"))
        by_state.setdefault(state, []).append(r)

    train_set, val_set, test_set = [], [], []
    for state, recs in by_state.items():
        random.shuffle(recs)
        n = len(recs)
        t1 = int(n * train)
        t2 = int(n * (train + val))
        train_set.extend(recs[:t1])
        val_set.extend(recs[t1:t2])
        test_set.extend(recs[t2:])

    random.shuffle(train_set)
    random.shuffle(val_set)
    random.shuffle(test_set)
    return train_set, val_set, test_set


def write_dataset_card(output_dir, records, stats, args, train_n, val_n, test_n):
    """Generate a dataset card / manifest."""
    state_dist = Counter(r.get("behavioral_state", "?") for r in records)
    quality_scores = [r.get("quality_score", 0) for r in records]
    
    card = {
        "dataset_name": f"synth_{args.domain}_{time.strftime('%Y%m%d')}",
        "description": args.task or f"Synthetic {args.domain} sensor-to-language dataset",
        "domain": args.domain,
        "total_records": len(records),
        "splits": {"train": train_n, "validation": val_n, "test": test_n},
        "state_distribution": dict(state_dist.most_common()),
        "quality": {
            "mean_score": round(sum(quality_scores) / max(len(quality_scores), 1), 3),
            "min_score": round(min(quality_scores) if quality_scores else 0, 3),
            "max_score": round(max(quality_scores) if quality_scores else 0, 3),
            "filtered_count": stats["filtered"],
        },
        "generation": {
            "records_per_state": args.count,
            "transition_records": stats["transitions"],
            "augmentation": "template_expansion + word_substitution + intensity_modifiers",
            "sensor_correlation": "beta_distribution_intensity + gaussian_noise",
            "deduplication": "sha256_text_hash",
        },
        "sensor_channels": list(set(
            k for r in records for k in r.get("sensor_input", {}).keys()
        )),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "generator_version": "2.0.0",
    }
    
    card_path = os.path.join(output_dir, "dataset_card.json")
    with open(card_path, "w", encoding="utf-8") as fh:
        json.dump(card, fh, indent=2, ensure_ascii=False)
    log(f"Dataset card: {card_path}")
    return card


def main():
    parser = argparse.ArgumentParser(description="Dataset Creator – Production Synthetic Generator v2")
    parser.add_argument("--domain", default="animal-sensor", help="Domain template")
    parser.add_argument("--task", default="", help="Task description")
    parser.add_argument("--count", type=int, default=200, help="Records per behavioral state")
    parser.add_argument("--sensors", default="", help="Comma-separated sensor filter")
    parser.add_argument("--output-format", default="jsonl", choices=["jsonl", "parquet", "csv"])
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    parser.add_argument("--min-quality", type=float, default=0.5, help="Minimum quality score (0-1)")
    args = parser.parse_args()

    log(f"=== Production Synthetic Generator v2 ===")
    log(f"Task: {args.task}")
    log(f"Domain: {args.domain} | Count/state: {args.count} | Min quality: {args.min_quality}")

    user_sensors = [s.strip().lower() for s in args.sensors.split(",") if s.strip()] if args.sensors else None
    if user_sensors:
        log(f"Sensor filter: {user_sensors}")

    # Generate
    records, stats = generate_dataset(args.domain, args.count, user_sensors, args.min_quality)
    log(f"Generated: {stats['generated']} primary + {stats['transitions']} transitions")
    log(f"Filtered (low quality): {stats['filtered']}")

    # Split
    train, val, test = split_dataset(records)
    log(f"Splits: train={len(train)}, val={len(val)}, test={len(test)}")

    # Write
    os.makedirs(args.output_dir, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")

    if args.output_format == "jsonl":
        write_jsonl(train, os.path.join(args.output_dir, f"train_{ts}.jsonl"))
        write_jsonl(val, os.path.join(args.output_dir, f"val_{ts}.jsonl"))
        write_jsonl(test, os.path.join(args.output_dir, f"test_{ts}.jsonl"))
    elif args.output_format in ("parquet", "csv"):
        try:
            import pandas as pd
            for name, split in [("train", train), ("val", val), ("test", test)]:
                flat = []
                for r in split:
                    row = {**r.get("sensor_input", {}),
                           "behavioral_state": r["behavioral_state"],
                           "language_output": r["language_output"],
                           "quality_score": r.get("quality_score", 0),
                           "confidence": r.get("confidence", 0)}
                    flat.append(row)
                df = pd.DataFrame(flat)
                ext = args.output_format
                path = os.path.join(args.output_dir, f"{name}_{ts}.{ext}")
                if ext == "parquet":
                    df.to_parquet(path, index=False)
                else:
                    df.to_csv(path, index=False)
                log(f"Wrote {len(flat)} records to {path}")
        except ImportError:
            log("pandas not installed. Falling back to JSONL.")
            write_jsonl(train, os.path.join(args.output_dir, f"train_{ts}.jsonl"))
            write_jsonl(val, os.path.join(args.output_dir, f"val_{ts}.jsonl"))
            write_jsonl(test, os.path.join(args.output_dir, f"test_{ts}.jsonl"))

    # Write dataset card
    card = write_dataset_card(args.output_dir, records, stats, args, len(train), len(val), len(test))

    log(f"\n{'='*60}")
    log(f"GENERATION COMPLETE")
    log(f"{'='*60}")
    log(f"Total records: {len(records)}")
    log(f"Quality mean: {card['quality']['mean_score']}")
    log(f"States: {len(card['state_distribution'])}")
    log(f"Sensors: {len(card['sensor_channels'])}")
    log(f"Train/Val/Test: {len(train)}/{len(val)}/{len(test)}")


if __name__ == "__main__":
    main()
