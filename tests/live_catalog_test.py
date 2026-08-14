# -*- coding: utf-8 -*-
"""Classification helpers for OpenAI-compatible live catalogues."""
import unittest

from agentscope.app._service._live_catalog import (
    classify_model_id,
    embedding_cards_from_ids,
    guess_embedding_dimensions,
    openai_compat_pass_dimensions,
    tts_cards_from_ids,
)
from agentscope.embedding import OpenAIEmbeddingModel
from agentscope.tts import OpenAITTSModel


class LiveCatalogTest(unittest.TestCase):
    """Pure classification / card-building, no network."""

    def test_classify_siliconflow_ids(self) -> None:
        """Chat, embedding, TTS and other ids split the way the UI needs."""
        self.assertEqual(
            classify_model_id("deepseek-ai/DeepSeek-V4-Flash"),
            "chat",
        )
        self.assertEqual(classify_model_id("BAAI/bge-m3"), "embedding")
        self.assertEqual(
            classify_model_id("Qwen/Qwen3-Embedding-8B"),
            "embedding",
        )
        self.assertEqual(
            classify_model_id("FunAudioLLM/CosyVoice2-0.5B"),
            "tts",
        )
        self.assertEqual(classify_model_id("fnlp/MOSS-TTSD-v0.5"), "tts")
        self.assertEqual(
            classify_model_id("BAAI/bge-reranker-v2-m3"),
            "other",
        )
        self.assertEqual(
            classify_model_id("FunAudioLLM/SenseVoiceSmall"),
            "other",
        )

    def test_embedding_dimensions(self) -> None:
        """Known families get a usable default dimension."""
        self.assertEqual(guess_embedding_dimensions("BAAI/bge-m3"), (1024, None))
        default, supported = guess_embedding_dimensions(
            "Qwen/Qwen3-Embedding-8B",
        )
        self.assertEqual(default, 4096)
        self.assertIn(1024, supported or [])

    def test_pass_dimensions(self) -> None:
        """Only variable-dim families send ``dimensions`` to the host."""
        self.assertTrue(openai_compat_pass_dimensions("text-embedding-3-small"))
        self.assertTrue(
            openai_compat_pass_dimensions("Qwen/Qwen3-Embedding-0.6B"),
        )
        self.assertFalse(openai_compat_pass_dimensions("BAAI/bge-m3"))

    def test_cards_filter_by_kind(self) -> None:
        """Card builders drop ids that are not of that kind."""
        ids = [
            "BAAI/bge-m3",
            "BAAI/bge-reranker-v2-m3",
            "FunAudioLLM/CosyVoice2-0.5B",
            "deepseek-ai/DeepSeek-V4-Flash",
        ]
        embeds = embedding_cards_from_ids(ids, OpenAIEmbeddingModel.Parameters)
        self.assertEqual([c.name for c in embeds], ["BAAI/bge-m3"])
        tts = tts_cards_from_ids(ids, OpenAITTSModel.Parameters)
        self.assertEqual(
            [c.name for c in tts],
            ["FunAudioLLM/CosyVoice2-0.5B"],
        )


if __name__ == "__main__":
    unittest.main()
