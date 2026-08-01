package chat

// 文档附件转发：实现已下沉到 internal/pkg/chatattach，与画布 AI 助手
// （handler/ai 的 assistant_chat）共用同一份 SSRF 白名单与体积上限。
// 这里只保留把本包 DTO 适配过去的薄封装，调用点签名不变。

import (
	"context"
	"strings"

	"tidecanvas/internal/pkg/chatattach"
	"tidecanvas/internal/pkg/relaychat"
)

// toAttaches 把本包的 MessageAttach 适配成共享包的 Attach。
func toAttaches(atts []MessageAttach) []chatattach.Attach {
	out := make([]chatattach.Attach, 0, len(atts))
	for _, a := range atts {
		out = append(out, chatattach.Attach{URL: strings.TrimSpace(a.URL), Kind: strings.TrimSpace(a.Kind)})
	}
	return out
}

// docFileParts 见 chatattach.Extractor.FileParts：返回可转发的文件 part 列表，
// 以及一段拼进当前轮 user 消息的附件说明。
func (s *service) docFileParts(ctx context.Context, atts []MessageAttach) ([]relaychat.FileAttachment, string) {
	return chatattach.Extractor{Hosts: s.docHosts}.FileParts(ctx, toAttaches(atts))
}
