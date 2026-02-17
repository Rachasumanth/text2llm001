package ai.text2llm.android.ui

import androidx.compose.runtime.Composable
import ai.text2llm.android.MainViewModel
import ai.text2llm.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
