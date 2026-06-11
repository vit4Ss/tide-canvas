package com.tidecanvas.controller.admin;

import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.EmailTemplatePreviewDTO;
import com.tidecanvas.model.dto.EmailTemplateSendTestDTO;
import com.tidecanvas.model.dto.EmailTemplateUpdateDTO;
import com.tidecanvas.model.vo.EmailRenderVO;
import com.tidecanvas.model.vo.EmailTemplateVO;
import com.tidecanvas.service.EmailTemplateService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 管理后台-邮件模板
 *
 * @author tidecanvas
 */
@Tag(name = "管理后台-邮件模板")
@RestController
@RequestMapping("/api/admin/email-templates")
@RequiredArgsConstructor
public class AdminEmailTemplateController {

    private final EmailTemplateService emailTemplateService;

    @Operation(summary = "模板列表")
    @GetMapping
    public Result<List<EmailTemplateVO>> list() {
        return Result.success(emailTemplateService.listTemplates());
    }

    @Operation(summary = "模板详情")
    @GetMapping("/{id}")
    public Result<EmailTemplateVO> get(@PathVariable Long id) {
        return Result.success(emailTemplateService.getTemplate(id));
    }

    @Operation(summary = "更新模板")
    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody EmailTemplateUpdateDTO dto) {
        emailTemplateService.updateTemplate(id, dto);
        return Result.success();
    }

    @Operation(summary = "预览渲染（编辑中内容+变量测试值，不落库）")
    @PostMapping("/preview")
    public Result<EmailRenderVO> preview(@Valid @RequestBody EmailTemplatePreviewDTO dto) {
        return Result.success(emailTemplateService.preview(dto));
    }

    @Operation(summary = "发送测试邮件（使用已保存内容）")
    @PostMapping("/{id}/send-test")
    public Result<Void> sendTest(@PathVariable Long id, @Valid @RequestBody EmailTemplateSendTestDTO dto) {
        emailTemplateService.sendTest(id, dto);
        return Result.success();
    }
}
