package com.tidecanvas.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.Result;
import com.tidecanvas.mapper.SysBannerMapper;
import com.tidecanvas.model.entity.SysBannerDO;
import com.tidecanvas.model.vo.BannerVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Banner 公开接口：首页轮播展示用，仅返回启用中的 Banner（按 sortOrder 升序）。
 *
 * @author tidecanvas
 */
@Tag(name = "Banner")
@RestController
@RequestMapping("/api/banners")
@RequiredArgsConstructor
public class BannerController {

    private final SysBannerMapper bannerMapper;

    @Operation(summary = "启用的Banner列表（首页轮播）")
    @GetMapping
    public Result<List<BannerVO>> list() {
        List<SysBannerDO> banners = bannerMapper.selectList(
                new LambdaQueryWrapper<SysBannerDO>()
                        .eq(SysBannerDO::getStatus, 1)
                        .orderByAsc(SysBannerDO::getSortOrder));
        List<BannerVO> result = banners.stream().map(b -> {
            BannerVO vo = new BannerVO();
            BeanUtils.copyProperties(b, vo);
            return vo;
        }).toList();
        return Result.success(result);
    }
}
