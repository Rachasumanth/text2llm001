package ai.text2llm.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class Text2llmProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", Text2llmCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", Text2llmCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", Text2llmCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", Text2llmCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", Text2llmCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", Text2llmCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", Text2llmCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", Text2llmCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", Text2llmCapability.Canvas.rawValue)
    assertEquals("camera", Text2llmCapability.Camera.rawValue)
    assertEquals("screen", Text2llmCapability.Screen.rawValue)
    assertEquals("voiceWake", Text2llmCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", Text2llmScreenCommand.Record.rawValue)
  }
}
