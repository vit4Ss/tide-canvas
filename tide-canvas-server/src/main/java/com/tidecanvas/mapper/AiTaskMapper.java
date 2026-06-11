package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.AiTaskDO;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

public interface AiTaskMapper extends BaseMapper<AiTaskDO> {

    AiTaskDO selectWithModel(@Param("taskId") Long taskId);

    Long countTodayCalls();

    List<Map<String, Object>> countByHandler();

    List<Map<String, Object>> countByDateRange(@Param("startDate") String startDate, @Param("endDate") String endDate);

    List<Map<String, Object>> modelUsageRank(@Param("limit") int limit);

    @Select("""
            SELECT *
            FROM ai_task
            WHERE id = #{taskId} AND deleted = 0
            FOR UPDATE
            """)
    AiTaskDO selectForUpdate(@Param("taskId") Long taskId);

    @Update("""
            UPDATE ai_task
            SET status = #{cancelledStatus}, complete_time = NOW(), update_time = NOW()
            WHERE id = #{taskId} AND user_id = #{userId} AND status = #{processingStatus} AND deleted = 0
            """)
    int cancelIfProcessing(@Param("taskId") Long taskId,
                           @Param("userId") Long userId,
                           @Param("processingStatus") Integer processingStatus,
                           @Param("cancelledStatus") Integer cancelledStatus);

    /** 异步任务轮询期间回写实时进度（仅处理中状态生效，不覆盖已完成/取消） */
    @Update("""
            UPDATE ai_task
            SET progress = #{progress}, update_time = NOW()
            WHERE id = #{taskId} AND status = #{processingStatus} AND deleted = 0
            """)
    int updateProgress(@Param("taskId") Long taskId,
                       @Param("progress") Integer progress,
                       @Param("processingStatus") Integer processingStatus);
}
