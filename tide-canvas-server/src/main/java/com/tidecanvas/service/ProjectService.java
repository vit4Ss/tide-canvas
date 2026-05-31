package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.model.dto.CanvasSaveDTO;
import com.tidecanvas.model.dto.ProjectCreateDTO;
import com.tidecanvas.model.dto.ProjectUpdateDTO;
import com.tidecanvas.model.query.ProjectQuery;
import com.tidecanvas.model.vo.ProjectDetailVO;
import com.tidecanvas.model.vo.ProjectVO;

public interface ProjectService {

    PageResult<ProjectVO> listProjects(Long userId, ProjectQuery query);

    ProjectVO createProject(Long userId, ProjectCreateDTO dto);

    ProjectDetailVO getProject(Long userId, Long projectId);

    ProjectDetailVO getProjectByToken(Long userId, String urlToken);

    ProjectVO updateProject(Long userId, Long projectId, ProjectUpdateDTO dto);

    void deleteProject(Long userId, Long projectId);

    void saveCanvas(Long userId, Long projectId, CanvasSaveDTO dto);

    String getCanvasData(Long userId, Long projectId);

    String shareProject(Long userId, Long projectId);
}
