local M = {}

---@type "auto" | "always" | "never"
local format_on_save_mode = 'auto'

local function on_buf_write()
  local mode = format_on_save_mode
  local format_command = nil
  if mode == 'always' then
    format_command = 'format-on-save.format'
  elseif mode == 'auto' then
    format_command = 'format-on-save.formatOnDemand'
  end

  if format_command then
    if vim.g.coc_service_initialized == 0 then
      vim.notify 'Skip formatting: coc.nvim is not ready yet'
      return
    end

    local ok, reason = pcall(vim.fn.CocAction, 'runCommand', format_command)
    if not ok then
      vim.notify(string.format('Formatting failed: %s', reason))
    end
  end
end

---Save with the command
---@param mode "auto" | "always" | "never"
---@param vim_save_command string
---@param file_name string
function M.save(mode, vim_save_command, file_name)
  format_on_save_mode = mode
  local save_command = vim_save_command
  if file_name then
    save_command = string.format('%s %s', save_command, file_name)
  end
  vim.cmd(save_command)
  format_on_save_mode = 'auto'
end

function M.setup()
  vim.api.nvim_create_autocmd('BufWritePre', {
    pattern = '*',
    callback = on_buf_write,
  })

  vim.api.nvim_create_user_command('W', function(ctx)
    M.save('never', 'write' .. (ctx.bang and '!' or ''), ctx.args)
  end, { nargs = '?', bang = true })

  vim.api.nvim_create_user_command('WA', function(ctx)
    M.save('never', 'wall' .. (ctx.bang and '!' or ''), ctx.args)
  end, { nargs = '?', bang = true })
end

return M
