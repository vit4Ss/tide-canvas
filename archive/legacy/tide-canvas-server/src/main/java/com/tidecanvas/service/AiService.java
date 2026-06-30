package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.model.dto.AiGenerateDTO;
import com.tidecanvas.model.query.AiTaskQuery;
import com.tidecanvas.model.vo.AiHandlerVO;
import com.tidecanvas.model.vo.AiModelVO;
import com.tidecanvas.model.vo.AiTaskVO;

import java.util.List;

public interface AiService {

    AiTaskVO generate(Long userId, AiGenerateDTO dto);

    AiTaskVO getTask(Long userId, Long taskId);

    void cancelTask(Long userId, Long taskId);

    PageResult<AiTaskVO> listTasks(Long userId, AiTaskQuery query);

    List<AiModelVO> listModels();

    List<AiHandlerVO> listHandlers();
}
