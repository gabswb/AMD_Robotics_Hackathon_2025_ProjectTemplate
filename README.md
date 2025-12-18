# 🤖 AMD Open Robotics Hackathon 2025

> **Pick. Scan. Sort.**

---

## 👥 Team Information

**Team Stereobot:** Thomas Gaviard, Haoran Wang & Gabriel Schwab

**Summary:** *Two arms, one model to rule them both.* Our bi-manual robot picks, scans, and sorts packages autonomously—an end-to-end, modular solution built for accurate and scalable warehouse automation.

https://github.com/user-attachments/assets/432d1f3d-6a5f-4893-bd81-b893cff9afdf

---

## 📋 Submission Details

### 1. Mission Description

Our mission demonstrates a **real-world warehouse automation** use case through a candy warehouse scenario:

- A bi-manual robotic system **autonomously picks and scans** items with one arm
- **Hands off** to a second arm for accurate sorting and packaging
- Showcases a **modular, end-to-end solution** for high-throughput fulfillment

### 2. Creativity

Our approach is novel in several ways:

| Feature | Description |
|---------|-------------|
| **Unified Model** | Single model coordinates bi-manual robotic tasks with seamless handoff |
| **Modular Design** | Independent of specific scanning or sorting technologies |
| **High Accuracy** | Maintains precision across different objects and scenarios |
| **Low-Cost & Adaptable** | Same framework deploys across different hardware setups |

### 3. Technical Implementation

#### 📹 Dataset Capture

https://github.com/user-attachments/assets/44792dfd-e260-454e-b1d6-f775cea8e952

#### 🧠 Training

We trained **ACT** on a compact dataset using the LeRobot training recipe:

| Parameter | Value |
|-----------|-------|
| Episodes | 150 (+ 30 fine-tuning) |
| Cameras | 4 (top, scan-state, 2× arm-mounted) |
| Training Steps | 35K |
| Hardware | AMD MI300X |

To improve robustness, we fine-tuned the model on 30 failure-case episodes.

#### ⚡ Inference

| Component | Specification |
|-----------|---------------|
| Platform | AMD Ryzen AI 9 HX370 PC |
| OS | Ubuntu 24.04 |
| ROCm | v6.3+ |
| PyTorch | v2.7.x |
| LeRobot | v0.4.1 |

### 4. Ease of Use

- ✅ **Generalization** — Successfully generalizes to trained and unseen objects
- ✅ **Flexibility** — Independent of specific scanning or warehouse setups
- ✅ **Simple Control** — Requires only color feedback, inference script, and items to pick

---

## 🎬 Demo

*High accuracy demonstration of our solution:*

https://github.com/user-attachments/assets/6aad2e10-6287-481a-ba9a-de118a41c07e

---

## 🔗 Resources

| Resource | Link |
|----------|------|
| 🏋️ Model Weights | [HuggingFace - amd-act-v3](https://huggingface.co/tms-gvd/amd-act-v3) |
| 📊 Core Dataset | [HuggingFace - amd-bimanual-core](https://huggingface.co/datasets/tms-gvd/amd-bimanual-core) |
| 📊 Fine-tune Dataset | [HuggingFace - amd-bimanual-finetune](https://huggingface.co/datasets/tms-gvd/amd-bimanual-finetune) |
