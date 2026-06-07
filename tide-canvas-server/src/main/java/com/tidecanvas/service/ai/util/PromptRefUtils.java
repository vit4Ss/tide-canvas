package com.tidecanvas.service.ai.util;

import java.util.regex.Pattern;

/**
 * 提示词中「图片N」内联引用的处理工具：判断与归一化为「{{Image N}}」。
 * 图生图与视频生成共用——把用户写的中文「图片N / 图N」统一成中转站/模型可识别的占位符，
 * 并按下发素材（image_urls / references）顺序绑定到第 N 张。
 *
 * @author tidecanvas
 */
public final class PromptRefUtils {

    /** 内联图片引用标记：中文「图片N / 图N」或英文「{{Image N}}」 */
    public static final Pattern INLINE_IMAGE_REF =
            Pattern.compile("(?:图片|图)\\s*\\d+|\\{\\{\\s*[Ii]mage\\s*\\d+\\s*}}");

    private PromptRefUtils() {
    }

    /** prompt 是否已含「图片N」/「{{Image N}}」内联引用 */
    public static boolean containsInlineImageRef(String prompt) {
        return prompt != null && INLINE_IMAGE_REF.matcher(prompt).find();
    }

    /** 把中文「图片N / 图N」统一替换为「{{Image N}}」（已是 {{Image N}} 的保留） */
    public static String normalizeInlineImageRefs(String prompt) {
        if (prompt == null) {
            return "";
        }
        return prompt.replaceAll("(?:图片|图)\\s*(\\d+)", "{{Image $1}}");
    }
}
