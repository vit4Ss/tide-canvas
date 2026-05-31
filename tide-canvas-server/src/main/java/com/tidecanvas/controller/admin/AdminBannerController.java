package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.Result;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.SysBannerMapper;
import com.tidecanvas.model.dto.BannerCreateDTO;
import com.tidecanvas.model.dto.BannerUpdateDTO;
import com.tidecanvas.model.entity.SysBannerDO;
import com.tidecanvas.model.vo.BannerVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "管理后台-Banner管理")
@RestController
@RequestMapping("/api/admin/banners")
@RequiredArgsConstructor
public class AdminBannerController {

    private final SysBannerMapper bannerMapper;

    @Operation(summary = "Banner列表")
    @GetMapping
    public Result<List<BannerVO>> list() {
        List<SysBannerDO> banners = bannerMapper.selectList(
                new LambdaQueryWrapper<SysBannerDO>().orderByAsc(SysBannerDO::getSortOrder));
        List<BannerVO> result = banners.stream().map(b -> {
            BannerVO vo = new BannerVO();
            BeanUtils.copyProperties(b, vo);
            return vo;
        }).toList();
        return Result.success(result);
    }

    @Operation(summary = "新增Banner")
    @PostMapping
    public Result<BannerVO> create(@Valid @RequestBody BannerCreateDTO dto) {
        SysBannerDO banner = new SysBannerDO();
        BeanUtils.copyProperties(dto, banner);
        if (banner.getSortOrder() == null) {
            banner.setSortOrder(0);
        }
        if (banner.getStatus() == null) {
            banner.setStatus(1);
        }
        banner.setDeleted(0);
        bannerMapper.insert(banner);
        BannerVO vo = new BannerVO();
        BeanUtils.copyProperties(banner, vo);
        return Result.success(vo);
    }

    @Operation(summary = "更新Banner")
    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody BannerUpdateDTO dto) {
        SysBannerDO banner = bannerMapper.selectById(id);
        if (banner == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        if (dto.getTitle() != null) {
            banner.setTitle(dto.getTitle());
        }
        if (dto.getImageUrl() != null) {
            banner.setImageUrl(dto.getImageUrl());
        }
        if (dto.getLinkUrl() != null) {
            banner.setLinkUrl(dto.getLinkUrl());
        }
        if (dto.getSortOrder() != null) {
            banner.setSortOrder(dto.getSortOrder());
        }
        if (dto.getStatus() != null) {
            banner.setStatus(dto.getStatus());
        }
        bannerMapper.updateById(banner);
        return Result.success();
    }

    @Operation(summary = "删除Banner")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        bannerMapper.deleteById(id);
        return Result.success();
    }
}
